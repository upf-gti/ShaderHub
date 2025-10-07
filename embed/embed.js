import { LX } from 'lexgui';
import * as Constants from "../src/constants.js";
import * as Utils from '../src/utils.js';
import { FS } from '../src/fs.js';
import { Renderer, FPSCounter, Shader, ShaderPass } from './graphics.js';

const fs = new FS();
const fps = new FPSCounter();
const Query = Appwrite.Query;

const ShaderHub =
{
    keyState: new Map(),
    keyToggleState: new Map(),
    keyPressed: new Map(),
    mousePosition: [ 0, 0 ],
    lastMousePosition: [ 0, 0 ],
    generateKbTexture: true,

    frameCount: 0,
    lastTime: 0,
    elapsedTime: 0,
    timePaused: false,

    async init()
    {
        this.area = await LX.init();

        const params = new URLSearchParams( document.location.search );
        const shaderUid = params.get( "shader" );
        const useUI = params.get( "ui" ) ? ( params.get( "ui" ) === "true" ) : true;

        if( !shaderUid ) return;
        
        const shader = await this.getShaderById( shaderUid );

        document.title = `${ shader.name } (${ shader.author }) - ShaderHub`;

        // Add shader visualization UI
        {
            let finalCanvasArea = this.area;
            let finalCanvasControlsArea = null;

            if( useUI )
            {
                let [ canvasArea, canvasControlsArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
                finalCanvasArea = canvasArea;
                finalCanvasControlsArea = canvasControlsArea;
            }

            const canvas = document.createElement("canvas");
            canvas.className = "webgpu-canvas w-full h-full rounded-t-lg";
            canvas.tabIndex = "0";

            // Manage canvas resize
            {
                let iResize = ( xResolution, yResolution ) => {
                    canvas.width = xResolution;
                    canvas.height = yResolution;
                    ShaderHub.onShaderCanvasResized( xResolution, yResolution );
                };

                let bestAttemptFallback = () => {
                    let devicePixelRatio = window.devicePixelRatio || 1;
                    let xResolution = Math.round( canvas.offsetWidth  * devicePixelRatio ) | 0;
                    let yResolution = Math.round( canvas.offsetHeight * devicePixelRatio ) | 0;
                    iResize( xResolution, yResolution );
                };

                if( !window.ResizeObserver )
                {
                    console.warn( "This browser doesn't support ResizeObserver." );
                    bestAttemptFallback();
                    window.addEventListener( "resize", bestAttemptFallback );
                }
                else
                {
                    this.ro = new ResizeObserver( function( entries, observer )
                    {
                        var entry = entries[ 0 ];
                        if( !entry['devicePixelContentBoxSize'] )
                        {
                            observer.unobserve( canvas );
                            console.warn( "This browser doesn't support ResizeObserver + device-pixel-content-box (2)" );
                            bestAttemptFallback();
                            window.addEventListener( "resize", bestAttemptFallback );
                        }
                        else
                        {
                            let box = entry.devicePixelContentBoxSize[ 0 ];
                            iResize( box.inlineSize, box.blockSize );
                        }
                    });

                    try
                    {
                        this.ro.observe( canvas, { box: ["device-pixel-content-box"] } );
                    }
                    catch( e )
                    {
                        console.warn( "This browser doesn't support ResizeObserver + device-pixel-content-box (1)");
                        bestAttemptFallback();
                        window.addEventListener( "resize", bestAttemptFallback );
                    }
                }
            }

            canvas.addEventListener('keydown', async (e) => {
                this.onKeyDown( e );
                e.preventDefault();
            }, false);

            canvas.addEventListener('keyup', async (e) => {
                this.onKeyUp( e );
                e.preventDefault();
            }, false);

            canvas.addEventListener("mousedown", (e) => {
                this.onMouseDown( e );
            });

            canvas.addEventListener("mouseup", (e) => {
                this.onMouseUp( e );
            });

            canvas.addEventListener("mousemove", (e) => {
                this.onMouseMove( e );
            });

            finalCanvasArea.attach( canvas );
        
            if( finalCanvasControlsArea )
            {
                finalCanvasControlsArea.root.className += " px-2 rounded-b-lg bg-secondary";
                const panel = finalCanvasControlsArea.addPanel( { className: "flex flex-row" } );
                panel.sameLine();
                panel.addButton( null, "ResetTime", () => this.onShaderTimeReset(), { icon: "SkipBack", title: "Reset time", tooltip: true } );
                panel.addButton( null, "PauseTime", () => this.onShaderTimePaused(), { icon: "Pause", title: "Pause/Resume", tooltip: true, swap: "Play" } );
                panel.addLabel( "0.0", { signal: "@elapsed-time", inputClass: "size-content" } );
                panel.addLabel( "0 FPS", { signal: "@fps", inputClass: "size-content" } );
                panel.addLabel( "0x0", { signal: "@resolution", inputClass: "size-content" } );
                panel.endLine( "items-center h-full" );
            }

            this.onShaderEditorCreated( shader, canvas );
        }
    },

    async onFrame()
    {
        const now = LX.getTime();

        this.timeDelta = ( now - this.lastTime ) / 1000;

        fps.count( now );

        if( !this.timePaused )
        {
            this.renderer.updateFrame( this.timeDelta, this.elapsedTime, this.frameCount );

            this.elapsedTime += this.timeDelta;

            this.frameCount++;

            LX.emit( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
            LX.emit( "@fps", `${ fps.get() } FPS` );
        }

        this.renderer.updateResolution( this.resolutionX, this.resolutionY );

        // Write mouse data
        {
            const data =
            [
                this.mousePosition[ 0 ], this.mousePosition[ 1 ],           // current position when pressed
                this.lastMousePosition[ 0 ], this.lastMousePosition[ 1 ],   // start position
                this.lastMousePosition[ 0 ] - this.mousePosition[ 0 ], 
                this.lastMousePosition[ 1 ] - this.mousePosition[ 1 ],      // delta position
                this._mouseDown ?? -1, this._mousePressed ?? -1.0      // button clicks
            ];

            this.renderer.updateMouse( data );
        }

        this.lastTime = now;

        for( let i = 0; i < this.shader.passes.length; ++i )
        {
            // Buffers and images draw
            const pass = this.shader.passes[ i ];
            if( pass.type === "common" ) continue;

            // Fill buffers and textures for each pass channel
            for( let c = 0; c < pass.channels?.length ?? 0; ++c )
            {
                const channelName = pass.channels[ c ];
                if( !channelName ) continue;

                if( !this.gpuTextures[ channelName ] )
                {
                    if( channelName === "Keyboard" )
                    {
                        await this.createKeyboardTexture( c );
                    }
                    else if( channelName.startsWith( "Buffer" ) )
                    {
                        await this.loadBufferChannel( pass, channelName, c )
                    }
                    else // Texture from file
                    {
                        await this.createTextureFromFile( channelName );
                    }
                }

                pass.setChannelTexture( c, this.gpuTextures[ channelName ] );
            }

            if( pass.uniformsDirty )
            {
                pass.updateUniforms();
            }

            if( !this._lastShaderCompilationWithErrors && !this._compilingShader )
            {
                await pass.execute( this.renderer );
            }
        }

        if( this._anyKeyPressed )
        {
            // event consumed, Clean input
            for( const [ name, value ] of this.keyPressed )
            {
                this.keyPressed.set( name, false );
            }

            await this.createKeyboardTexture();

            this._anyKeyPressed = false;
        }

        this._mousePressed = false;

        if( this.capturer )
        {
            this.capturer.capture( this.gpuCanvas );

            this.captureFrameCount++;

            if( this.captureFrameCount == this.exportFramesCount )
            {
                this.saveCapture();
            }
        }

        requestAnimationFrame( this.onFrame.bind( this ) );
    },

    async onKeyDown( e )
    {
        this.keyState.set( Utils.code2ascii( e.code ), true );
        if( this.generateKbTexture ) await this.createKeyboardTexture();
        this.generateKbTexture = false;
    },

    async onKeyUp( e )
    {
        this.keyState.set( Utils.code2ascii( e.code ), false );
        this.keyToggleState.set( Utils.code2ascii( e.code ), !( this.keyToggleState.get( Utils.code2ascii( e.code ) ) ?? false ) );
        this.keyPressed.set( Utils.code2ascii( e.code ), true );
        this._anyKeyPressed = true;
        await this.createKeyboardTexture();
        this.generateKbTexture = true;
    },

    async onMouseDown( e )
    {
        this._mouseDown = parseInt( e.button );
        this._mousePressed = this._mouseDown;
        this.mousePosition = [ e.offsetX, e.offsetY ];
        this.lastMousePosition = [ ...this.mousePosition ];
    },

    async onMouseUp( e )
    {
        this._mouseDown = undefined;
    },

    async onMouseMove( e )
    {
        if( this._mouseDown !== undefined )
        {
            this.mousePosition = [ e.offsetX, e.offsetY ];
        }
    },

    async onShaderCanvasResized( xResolution, yResolution )
    {
        this.resizeBuffers( xResolution, yResolution );

        this.renderer.updateResolution( xResolution, yResolution );

        LX.emit( '@resolution', `${ xResolution }x${ yResolution }` );

        this.resolutionX = xResolution;
        this.resolutionY = yResolution;
    },

    async onShaderEditorCreated( shader, canvas )
    {
        this.shader = shader;

        await this.initGraphics( canvas );

        const closeFn = async ( name, e ) => {
            e.preventDefault();
            e.stopPropagation();
            ui.editor.tabs.delete( name );
            document.body.querySelectorAll( ".lextooltip" ).forEach( e => e.remove() );

            // Destroy pass
            {
                const passIndex = this.shader.passes.findIndex( p => p.name === name );
                const pass = this.shader.passes[ passIndex ];
                if( pass.type === "buffer" )
                {
                    delete this.gpuTextures[ pass.name ];
                }

                this.shader.passes.splice( passIndex, 1 );

                await this.compileShader();
            }
        };

        // Prob. new shader
        if( !this.shader.url )
        {
            const pass = {
                name: "MainImage",
                type: "image",
                codeLines: Shader.RENDER_MAIN_TEMPLATE,
                resolutionX: this.resolutionX,
                resolutionY: this.resolutionY
            }

            const shaderPass = new ShaderPass( shader, this.device, pass );
            this.shader.passes.push( shaderPass );
            this.shader.likes = [];
        }
        else
        {
            const json = JSON.parse( await fs.requestFile( this.shader.url, "text" ) );
            console.assert( json, "DB: No JSON Shader data available!" );

            this.shader._json = LX.deepCopy( json );
            this.shader.likes = [ ...( json.likes ?? [] ) ];

            for( const pass of json.passes ?? [] )
            {
                pass.resolutionX = this.resolutionX;
                pass.resolutionY = this.resolutionY;

                pass.uniforms = pass.uniforms ?? [];
                pass.uniforms.forEach( u => u.type = u.type ?? "f32");

                // Push passes to the shader
                const shaderPass = new ShaderPass( shader, this.device, pass );
                if( pass.type === "buffer" || pass.type === "compute" )
                {
                    console.assert( shaderPass.textures, "Buffer does not have render target textures" );
                    this.gpuTextures[ pass.name ] = shaderPass.textures;
                }
                this.shader.passes.push( shaderPass );

                if( pass.name !== "MainImage" )
                {
                    const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
                    LX.asTooltip( closeIcon, "Delete file" );
                    closeIcon.addEventListener( "click", closeFn.bind( this, pass.name ) );
                }
            }
        }

        const alreadyLiked = fs?.user && this.shader.likes.includes( fs.getUserId() );
        LX.emit( "@on_like_changed", [ this.shader.likes.length, alreadyLiked ] );

        this.currentPass = this.shader.passes.at( -1 );
    },

    onShaderTimePaused()
    {
        this.timePaused = !this.timePaused;
    },

    onShaderTimeReset()
    {
        fps.reset();

        this.frameCount = 0;
        this.elapsedTime = 0;
        this.timeDelta = 0;

        this.renderer.updateFrame( 0, 0, 0 );

        // Reset mouse data
        {
            const X = this.resolutionX ?? this.gpuCanvas.offsetWidth;
            const Y = this.resolutionY ?? this.gpuCanvas.offsetHeight;

            this.mousePosition      = [ X * 0.5, Y * 0.5 ];
            this.lastMousePosition  = this.mousePosition;

            this._mouseDown     = undefined;
            this._mousePressed  = undefined;

            const data =
            [
                this.mousePosition[ 0 ], this.mousePosition[ 1 ],           // current position when pressed
                this.lastMousePosition[ 0 ], this.lastMousePosition[ 1 ],   // start position
                this.lastMousePosition[ 0 ] - this.mousePosition[ 0 ], 
                this.lastMousePosition[ 1 ] - this.mousePosition[ 1 ],      // delta position
                this._mouseDown ?? -1, this._mousePressed ?? -1.0      // button clicks
            ];

            this.renderer.updateMouse( data );
        }

        if( this.currentPass )
        {
            this.currentPass.resetExecution();
        }

        LX.emit( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
    },

    async getShaderById( id )
    {
        let shaderData = null;

        // Create shader instance based on shader uid
        // Get all stored shader files (not the code, only the data)
        if( id !== "new" )
        {
            let result;

            try {
                result = await fs.getDocument( FS.SHADERS_COLLECTION_ID, id );
            } catch (error) {
                LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shader found.", this.area );
                return;
            }

            shaderData = {
                name: result.name,
                uid: id,
                url: await fs.getFileUrl( result[ "file_id" ] ),
                description: result.description ?? "",
                creationDate: Utils.toESDate( result[ "$createdAt" ] ),
                originalId: result[ "original_id" ]
            };

            const authorId = result[ "author_id" ];
            if( authorId )
            {
                const users = await fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorId ) ] );
                const authorName = users.documents[ 0 ][ "user_name" ];
                shaderData.author = authorName;
                shaderData.authorId = authorId;
            }
            else
            {
                shaderData.author = result[ "author_name" ];
                shaderData.anonAuthor = true;
            }
        }
        else
        {
            shaderData = {
                name: "New Shader",
                uid: "EMPTY_ID",
                author: fs.user?.name ?? "Anonymous",
                anonAuthor: true,
                creationDate: Utils.getDate()
            };
        }

        return new Shader( shaderData );
    },

    resizeBuffers( resolutionX, resolutionY )
    {
        for( const pass of this.shader.passes )
        {
            if( pass.type !== "buffer" )
                continue;

            pass.resizeBuffer( resolutionX, resolutionY );
        }
    },

    async initGraphics( canvas )
    {
        this.renderer = new Renderer( canvas );

        await this.renderer.init();

        requestAnimationFrame( this.onFrame.bind( this) );
    },

    async createKeyboardTexture( channel, updatePreview = false )
    {
        const dimensions = [ 256, 3 ];
        const data = [];

        // Key state
        for( let w = 0; w < dimensions[ 0 ]; w++ )
        {
            data.push( 255 * ( this.keyState.get( w ) === true ? 1 : 0 ), 0, 0, 255 );
        }

        // Key toggle state
        for( let w = 0; w < dimensions[ 0 ]; w++ )
        {
            data.push( 255 * ( this.keyToggleState.get( w ) === true ? 1 : 0 ), 0, 0, 255 );
        }

        // Key pressed
        for( let w = 0; w < dimensions[ 0 ]; w++ )
        {
            data.push( 255 * ( this.keyPressed.get( w ) === true ? 1 : 0 ), 0, 0, 255 );
        }

        const imageName = "Keyboard";
        const imageData = new ImageData( new Uint8ClampedArray( data ), dimensions[ 0 ], dimensions[ 1 ] );
        const imageBitmap = await createImageBitmap( imageData );
        const imageTexture = this.gpuTextures[ imageName ] ?? this.device.createTexture({
            label: "KeyboardTexture",
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
            format: 'rgba8unorm',
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: imageTexture },
            dimensions
        );

        // Recreate stuff if we update the texture and
        // a shader pass is using it
        this.gpuTextures[ imageName ] = imageTexture;

        const pass = this.currentPass;
        const usedChannel = pass.channels.indexOf( imageName );
        if( ( channel === undefined ) && usedChannel > -1 )
        {
            channel = usedChannel;
        }

        if( channel !== undefined )
        {
            pass.channels[ channel ] = imageName;

            if( updatePreview )
            {
                await ui.updateShaderChannelsView( pass );
            }
        }
    },

    async compileShader( showFeedback = true, pass, focusCanvas = false, manualCompile = false )
    {
        this._lastShaderCompilationWithErrors = false;
        this._compilingShader = true;

        const compilePasses = pass ? [ pass ] : this.shader.passes;

        for( let i = 0; i < compilePasses.length; ++i )
        {
            // Buffers and images draw
            const pass = compilePasses[ i ];
            if( pass.type === "common" ) continue;

            const result = await pass.compile( this.presentationFormat, this.gpuBuffers );
            if( result !== WEBGPU_OK ) // error object
            {
                this._lastShaderCompilationWithErrors = true;
                return WEBGPU_ERROR; // Stop at first error
            }
        }

        if( focusCanvas )
        {
            this.gpuCanvas.focus();
        }

        this.manualCompile |= ( manualCompile ?? false );
        this._compilingShader = false;

        return WEBGPU_OK;
    },

    async loadBufferChannel( pass, bufferName, channel, updatePreview = false, forceCompile = false )
    {
        pass.channels[ channel ] = bufferName;

        if( forceCompile )
        {
            await this.compileShader( true, pass );
        }
    }
}

await ShaderHub.init();

window.LX = LX;
window.fs = fs;
window.ShaderHub = ShaderHub;

export { ShaderHub };
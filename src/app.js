import { LX } from 'lexgui';
import * as Constants from "./constants.js";
import * as Utils from './utils.js';
import { FS } from './fs.js';
import { ui } from './ui.js';
import { FPSCounter, Shader, ShaderPass } from './graphics.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const ERROR_CODE_DEFAULT    = 0;
const ERROR_CODE_SUCCESS    = 1;
const ERROR_CODE_ERROR      = 2;

const fs =      new FS();
const fps =     new FPSCounter();
const Query =   Appwrite.Query;

const ShaderHub =
{
    gpuTextures: {},
    gpuBuffers: {},

    keyState:           new Map(),
    keyToggleState:     new Map(),
    keyPressed:         new Map(),
    mousePosition:      [ 0, 0 ],
    lastMousePosition:  [ 0, 0 ],

    frameCount:         0,
    lastTime:           0,
    elapsedTime:        0,
    capturer:           null,
    generateKbTexture:  true,
    timePaused:         false,
    manualCompile:      false,

    async init()
    {
        await fs.detectAutoLogin();
        await ui.init( fs );
    },

    async onFrame()
    {
        const now = LX.getTime();

        this.timeDelta = ( now - this.lastTime ) / 1000;

        fps.count( now );

        if( !this.timePaused )
        {
            this.device.queue.writeBuffer(
                this.gpuBuffers[ "timeDelta" ],
                0,
                new Float32Array([ this.timeDelta ])
            );

            this.device.queue.writeBuffer(
                this.gpuBuffers[ "time" ],
                0,
                new Float32Array([ this.elapsedTime ])
            );

            this.elapsedTime += this.timeDelta;

            this.device.queue.writeBuffer(
                this.gpuBuffers[ "frameCount" ],
                0,
                new Int32Array([ this.frameCount ])
            );

            this.frameCount++;

            LX.emit( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
            LX.emit( "@fps", `${ fps.get() } FPS` );
        }

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "resolution" ],
            0,
            new Float32Array([ this.resolutionX ?? this.gpuCanvas.offsetWidth, this.resolutionY ?? this.gpuCanvas.offsetHeight ])
        );

        // Write mouse data
        {
            const data =
            [
                this.mousePosition[ 0 ], this.mousePosition[ 1 ],           // current position when pressed
                this.lastMousePosition[ 0 ], this.lastMousePosition[ 1 ],   // start position
                this.lastMousePosition[ 0 ] - this.mousePosition[ 0 ], 
                this.lastMousePosition[ 1 ] - this.mousePosition[ 1 ],      // delta position
                this._mouseDown ?? -1, this._mousePressed ? 1.0 : -1.0      // button clicks
            ];

            this.device.queue.writeBuffer(
                this.gpuBuffers[ "mouse" ],
                0,
                new Float32Array( data )
            );
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
                        // Only update preview in case that's the current pass
                        await this.createTexture( channelName, c );
                    }
                }

                pass.setChannelTexture(  c, this.gpuTextures[ channelName ] );
            }

            if( pass.uniformsDirty )
            {
                pass.updateUniforms();
            }

            if( !this._lastShaderCompilationWithErrors )
            {
                await pass.draw(
                    this.presentationFormat,
                    this.webGPUContext,
                    this.gpuBuffers
                );
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
        this.mousePosition = [ e.offsetX, this.gpuCanvas.offsetHeight - e.offsetY ];
        this.lastMousePosition = [ ...this.mousePosition ];
        this._mousePressed = true;
    },

    async onMouseUp( e )
    {
        this._mouseDown = undefined;
    },

    async onMouseMove( e )
    {
        if( this._mouseDown !== undefined )
        {
            this.mousePosition = [ e.offsetX, this.gpuCanvas.offsetHeight - e.offsetY ];
        }
    },

    async onShaderCanvasResized( xResolution, yResolution )
    {
        this.resizeBuffers( xResolution, yResolution );
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

            // Set code in the editor
            ui.editor.addTab( pass.name, false, pass.name, { codeLines: pass.codeLines, language: "WGSL" } );
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

                // Set code in the editor
                ui.editor.addTab( pass.name, false, pass.name, { codeLines: pass.codeLines, language: "WGSL" } );

                if( pass.name !== "MainImage" )
                {
                    const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
                    LX.asTooltip( closeIcon, "Delete file" );
                    closeIcon.addEventListener( "click", closeFn.bind( this, pass.name ) );
                    ui.editor.tabs.tabDOMs[ pass.name ].appendChild( closeIcon );
                }
            }
        }

        const alreadyLiked = fs?.user && this.shader.likes.includes( fs.getUserId() );
        LX.emit( "@on_like_changed", [ this.shader.likes.length, alreadyLiked ] );

        this.currentPass = this.shader.passes.at( -1 );

        ui.editor.loadTab( this.currentPass.name );
    },

    async onShaderLike()
    {
        const userId = fs.getUserId();

        const likeIndex = this.shader.likes.indexOf( userId );
        if( likeIndex !== -1 )
        {
            this.shader.likes.splice( likeIndex, 1 );
        }
        else
        {
            this.shader.likes.push( userId );
        }

        const alreadyLiked = this.shader.likes.includes( userId );
        LX.emit( "@on_like_changed", [ this.shader.likes.length, alreadyLiked ] );

        let result = await ShaderHub.shaderExists();
        await this.saveShader( result, false, false );
    },

    onShaderPassCreated( passType, passName )
    {
        let indexOffset = -1;

        const shaderPass = new ShaderPass( this.shader, this.device, {
            name: passName,
            type: passType,
            resolutionX: this.resolutionX,
            resolutionY: this.resolutionY
        } );

        const getNextBufferName = () => {
            const usedNames = this.shader.passes.filter( p => p.type === "buffer" ).map( p => p.name );
            const possibleNames = ["BufferA", "BufferB", "BufferC", "BufferD"];

            // Find the first unused name
            for( const name of possibleNames )
            {
                if( !usedNames.includes( name )) return name;
            }

            // All used, should not happen due to prev checks
            return null;
        }

        if( passType === "buffer" )
        {
            indexOffset = -2;
            passName = shaderPass.name = getNextBufferName();
            this.shader.passes.splice( this.shader.passes.length - 1, 0, shaderPass ); // Add before MainImage

            console.assert( shaderPass.textures, "Buffer does not have render target textures" );
            this.gpuTextures[ passName ] = shaderPass.textures;
        }
        else if( passType === "compute" )
        {
            // const getNextComputeName = () => {
            //     const usedNames = this.shader.passes.filter( p => p.type === "compute" ).map( p => p.name );
            //     const possibleNames = ["ComputeA", "ComputeB", "ComputeC", "ComputeD"];

            //     // Find the first unused name
            //     for( const name of possibleNames )
            //     {
            //         if( !usedNames.includes( name )) return name;
            //     }

            //     // All used, should not happen due to prev checks
            //     return null;
            // }

            indexOffset = -2;
            passName = shaderPass.name = getNextBufferName();
            this.shader.passes.splice( this.shader.passes.length - 1, 0, shaderPass ); // Add before MainImage

            console.assert( shaderPass.textures, "Compute does not have render target textures" );
            this.gpuTextures[ passName ] = shaderPass.textures;
        }
        else if( passType === "common" )
        {
            indexOffset = -( this.shader.passes.length + 1 );
            this.shader.passes.splice( 0, 0, shaderPass ); // Add at the start
        }

        ui.editor.addTab( passName, true, passName, {
            indexOffset,
            language: "WGSL",
            codeLines: shaderPass.codeLines
        } );

        // Wait for the tab to be created
        LX.doAsync( async () => {

            const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
            LX.asTooltip( closeIcon, "Delete file" );
            closeIcon.addEventListener( "click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                editor.tabs.delete( passName );
                document.body.querySelectorAll( ".lextooltip" ).forEach( e => e.remove() );
            } );

            ui.editor.tabs.tabDOMs[ passName ].appendChild( closeIcon );

            this.onShaderPassSelected( passName );

            await this.compileShader( false, shaderPass );

        }, 10 );
    },

    async onShaderPassSelected( passName )
    {
        this.currentPass = this.shader.passes.find( p => p.name === passName );
        console.assert( this.currentPass, `Cannot find pass ${ passName }` );

        await ui.updateShaderChannelsView();

        ui.toggleCustomUniformsButton( this.currentPass.type === "common" );
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

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "timeDelta" ],
            0,
            new Float32Array([ this.timeDelta ])
        );

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "time" ],
            0,
            new Float32Array([ this.elapsedTime ])
        );

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "frameCount" ],
            0,
            new Int32Array([ this.frameCount ])
        );

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

    async getChannelMetadata( pass, channel )
    {
        let name = pass.channels[ channel ], url = null;

        if( !pass ) url = Constants.IMAGE_EMPTY_SRC;
        else
        {
            const assetFileId = pass.channels[ channel ];
            if( !assetFileId ) url = Constants.IMAGE_EMPTY_SRC;
            else if( assetFileId === "Keyboard" ) url = "images/keyboard.png";
            else if( assetFileId.startsWith( "Buffer" ) ) url = "images/buffer.png";
            else if( assetFileId.startsWith( "Compute" ) ) url = "images/buffer.png"; // TODO: Change preview image for computes
            else
            {
                const result = await fs.listDocuments( FS.ASSETS_COLLECTION_ID, [ Query.equal( "file_id", assetFileId ) ] );
                console.assert( result.total == 1, `Inconsistent asset list for file id ${ assetFileId }` );
                const preview = result.documents[ 0 ][ "preview" ];
                url = preview ? await fs.getFileUrl( preview ) : await fs.getFileUrl( assetFileId );
                name = result.documents[ 0 ].name;
            }
        }

        return { url, name }
    },

    resizeBuffers( resolutionX, resolutionY )
    {
        for( const pass of this.shader.passes )
        {
            if( pass.type !== "buffer" && pass.type !== "compute" )
                continue;

            pass.resizeBuffer( resolutionX, resolutionY );
        }
    },

    requestFullscreen( element )
    {
        element = element ?? this.gpuCanvas;

        if( element == null ) element = document.documentElement;
        if( element.requestFullscreen ) element.requestFullscreen();
        else if( element.msRequestFullscreen ) element.msRequestFullscreen();
        else if( element.mozRequestFullScreen ) element.mozRequestFullScreen();
        else if( element.webkitRequestFullscreen ) element.webkitRequestFullscreen( Element.ALLOW_KEYBOARD_INPUT );

        if( element.focus ) element.focus();
    },

    isFullScreen()
    {
        return document.fullscreen || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement;
    },

    exitFullscreen()
    {
        if( document.exitFullscreen ) document.exitFullscreen();
        else if( document.msExitFullscreen ) document.msExitFullscreen();
        else if( document.mozCancelFullScreen ) document.mozCancelFullScreen();
        else if( document.webkitExitFullscreen ) document.webkitExitFullscreen();
    },

    getFullPath()
    {
        return window.location.origin + window.location.pathname;
    },

    openBrowseList()
    {
        const needsReload = window.location.search === "";
        window.location.href = `${ this.getFullPath() }#browse`;
        if( needsReload ) window.location.reload();
    },

    openProfile( userID )
    {
        window.location.href = `${ this.getFullPath() }?profile=${ userID }`;
    },

    openShader( shaderID )
    {
        window.location.href = `${ this.getFullPath() }?shader=${ shaderID }`;
    },

    openHelp()
    {
        const needsReload = window.location.search === "";
        window.location.href = `${ this.getFullPath() }#help`;
        if( needsReload ) window.location.reload();
    },

    async saveShaderFiles( ownShader, isRemix )
    {
        const passes = ownShader ? this.shader.passes : ( this.shader._json?.passes ?? this.shader.passes );
        const likes = isRemix ? [] : this.shader.likes; // can be updated by anyone, use latest data

        // Upload file and get id
        const json = {
            name: this.shader.name, // only updated by user
            likes: likes,
            // use json data or updated data depending on who's saving
            passes: passes.map( p => {
                return {
                    "name": p.name,
                    "type": p.type,
                    "codeLines": p.codeLines,
                    "channels": p.channels,
                    "uniforms": p.uniforms
                }
            } )
        };

        const text = JSON.stringify( json );
        const arraybuffer = new TextEncoder().encode( text );
        const filename = `${ LX.toCamelCase( this.shader.name ) }.json`;
        const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
        const result = await fs.createFile( file );
        return result[ "$id" ];
    },

    async saveShader( existingShader, updateThumbnail = true, showFeedback = true )
    {
        if( !fs.user )
        {
            console.warn( "Login to save your shader!" );
            return;
        }

        if( existingShader )
        {
            this.overrideShader( existingShader, updateThumbnail, showFeedback );
            return;
        }

        const dialog = new LX.Dialog( "Confirm Shader name", ( p ) => {
            let shaderName = this.shader.name;
            const textInput = p.addText( "Name", shaderName, ( v ) => {
                shaderName = v;
            }, { pattern: LX.buildTextPattern( { minLength: 3 } ) } );
            p.addSeparator();
            p.sameLine( 2 );
            p.addButton( null, "Cancel", () => dialog.close(), { width: "50%", buttonClass: "bg-error fg-white" } );
            p.addButton( null, "Confirm", async () => {
                if( !shaderName.length || !textInput.valid( shaderName ) )
                {
                    return;
                }

                const ownShader = ( this.shader.authorId === fs.getUserId() );
                const newFileId = await this.saveShaderFiles( ownShader );

                // Create a new shader in the DB
                const result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
                    "name": shaderName,
                    "description": this.shader.description,
                    "author_id": fs.getUserId(),
                    "author_name": this.shader.author ?? "",
                    "file_id": newFileId,
                    "like_count": this.shader.likes.length,
                    "features": this.shader.getFeatures()
                } );

                this.shader.uid = result[ "$id" ];
                this.shader.name = shaderName;

                // Upload canvas snapshot
                await this.updateShaderPreview( this.shader.uid, false );

                // Close dialog on succeed and show toast
                dialog.close();
                Utils.toast( `✅ Shader saved`, `Shader: ${ shaderName } by ${ fs.user.name }` );
            }, { width: "50%", buttonClass: "contrast" } );
        } );
    },

    async overrideShader( shaderMetadata, updateThumbnail = true, showFeedback = true )
    {
        // Delete old file first
        const fileId = shaderMetadata[ "file_id" ];
        await fs.deleteFile( fileId );

        const ownShader = ( this.shader.authorId === fs.getUserId() );
        const newFileId = await this.saveShaderFiles( ownShader );

        // Update files reference in the DB
        const row = {
            "file_id": newFileId,
            "like_count": this.shader.likes.length
        };

        // Update specific stuff only if shader owner
        if( ownShader )
        {
            row[ "name" ] = this.shader.name,
            row[ "description" ] = this.shader.description,
            row[ "features" ] = this.shader.getFeatures();

            if( updateThumbnail )
            {
                await this.updateShaderPreview( this.shader.uid, false );
            }
        }

        await fs.updateDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid, row );

        if( ownShader && showFeedback )
        {
            Utils.toast( `✅ Shader updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }` );
        }
    },

    async deleteShader()
    {
        let result = await this.shaderExists();
        if( !result )
        {
            return;
        }

        const innerDelete = async () => {

            // DB entry
            await fs.deleteDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid );

            // Shader files
            await fs.deleteFile( result[ "file_id" ] );

            // Preview
            const previewName = `${ this.shader.uid }.png`;
            result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
            if( result.total > 0 )
            {
                await fs.deleteFile( result.files[ 0 ][ "$id" ] );
            }

            Utils.toast( `✅ Shader deleted`, `Shader: ${ this.shader.name } by ${ fs.user.name }` );

        };

        const dialog = new LX.Dialog( "Delete shader", (p) => {
            p.root.classList.add( "p-2" );
            p.addTextArea( null, "Are you sure? This action cannot be undone.", null, { disabled: true } );
            p.addSeparator();
            p.sameLine( 2 );
            p.addButton( null, "Cancel", () => dialog.close(), { width: "50%", buttonClass: "bg-error fg-white" } );
            p.addButton( null, "Continue", innerDelete.bind( this ), { width: "50%", buttonClass: "contrast" } );
        }, { modal: true } );
    },

    async remixShader()
    {
        // Save the shader with you as the author id
        // Create a new col to store original_id so it can be shown in the page
        // Get the new shader id, and reload page in shader view with that id

        const shaderName = this.shader.name;
        const shaderUid = this.shader.uid;
        const newFileId = await this.saveShaderFiles( false, true );

        // Create a new shader in the DB
        const result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
            "name": shaderName,
            "author_name": fs.user.name,
            "author_id": fs.getUserId(),
            "original_id": shaderUid,
            "file_id": newFileId,
            "description": this.shader.description,
            "like_count": 0
        } );

        // Upload canvas snapshot
        await this.updateShaderPreview( shaderUid, false );

        // Go to shader edit view with the new shader
        this.openShader( result[ "$id" ] );
    },

    async updateShaderPreview( shaderUid, showFeedback = true )
    {
        shaderUid = shaderUid ?? this.shader.uid;

        // Delete old preview first if necessary
        const previewName = `${ shaderUid }.png`;
        const result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
        if( result.total > 0 )
        {
            const fileId = result.files[ 0 ][ "$id" ];
            await fs.deleteFile( fileId );
        }

        // Create new one
        const blob = await this.snapshotCanvas();
        const file = new File( [ blob ], previewName, { type: "image/png" });
        await fs.createFile( file );

        if( showFeedback )
        {
            Utils.toast( `✅ Shader preview updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }` );
        }
    },

    async initGraphics( canvas )
    {
        this.gpuCanvas = canvas;
        this.adapter = await navigator.gpu?.requestAdapter({
            featureLevel: 'compatibility',
        });

        this.device = await this.adapter?.requestDevice();
        if( this.quitIfWebGPUNotAvailable( this.adapter, this.device ) === WEBGPU_ERROR )
        {
            return;
        }

        this.webGPUContext = canvas.getContext( 'webgpu' );

        const devicePixelRatio = window.devicePixelRatio;
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;

        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.webGPUContext.configure({
            device: this.device,
            format: this.presentationFormat,
        });

        // Input Parameters
        {
            this.gpuBuffers[ "time" ] = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "timeDelta" ] = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "frameCount" ] = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "resolution" ] = this.device.createBuffer({
                size: 8,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "mouse" ] = this.device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });
        }

        Shader.globalSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        requestAnimationFrame( this.onFrame.bind( this) );
    },

    async createTexture( fileId, channel, updatePreview = false, options = { } )
    {
        if( !fileId )
        {
            return;
        }

        options = { ...options, flipY: true };

        const url = await fs.getFileUrl( fileId );
        const data = await fs.requestFile( url );
        const imageBitmap = await createImageBitmap( await new Blob([data]) );
        const dimensions = [ imageBitmap.width, imageBitmap.height ];
        const imageTexture = this.device.createTexture({
            label: fileId,
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
            format: 'rgba8unorm',
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap, ...options },
            { texture: imageTexture },
            dimensions
        );

        this.gpuTextures[ fileId ] = imageTexture;

        if( updatePreview )
        {
            await ui.updateShaderChannelsView( null, channel );
        }

        return imageTexture;
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

    setEditorErrorBorder( errorCode = ERROR_CODE_DEFAULT )
    {
        ui.editor.area.root.parentElement.classList.toggle( "code-border-default", errorCode === ERROR_CODE_DEFAULT );
        ui.editor.area.root.parentElement.classList.toggle( "code-border-success", errorCode === ERROR_CODE_SUCCESS );
        ui.editor.area.root.parentElement.classList.toggle( "code-border-error", errorCode === ERROR_CODE_ERROR );

        if( !this._mustResetBorder )
        {
            LX.doAsync( () => {
                this.setEditorErrorBorder();
                this._mustResetBorder = false;
            }, 2000 );
        }

        this._mustResetBorder = true;
    },

    async compileShader( showFeedback = true, pass, focusCanvas = false, manualCompile = false )
    {
        this._lastShaderCompilationWithErrors = false;

        ui.editor.processLines();

        const tabs = ui.editor.tabs.tabs;
        const compilePasses = pass ? [ pass ] : this.shader.passes;

        for( let i = 0; i < compilePasses.length; ++i )
        {
            // Buffers and images draw
            const pass = compilePasses[ i ];
            pass.codeLines = tabs[ pass.name ].lines;
            console.assert( pass.codeLines, `No tab with name ${ pass.name }` );
            if( pass.type === "common" ) continue;

            const result = await pass.compile( this.presentationFormat, this.gpuBuffers );
            if( result !== WEBGPU_OK ) // error object
            {
                ui.editor.loadTab( pass.name ); // Open the tab with the error

                // Make async so the tab is opened before adding the error feedback
                LX.doAsync( () => {

                    const mainImageLineOffset = result.code.split( "\n" ).indexOf( pass.codeLines[ 0 ] );
                    console.assert( mainImageLineOffset > 0 );

                    for( const msg of result.messages )
                    {
                        const fragLineNumber = msg.lineNum - ( mainImageLineOffset );

                        if( showFeedback )
                        {
                            this.setEditorErrorBorder( ERROR_CODE_ERROR );
                            Utils.toast( `❌ ${ LX.toTitleCase( msg.type ) }: ${ fragLineNumber }:${ msg.linePos }`, msg.message, -1 );
                            ui.editor.code.childNodes[ fragLineNumber - 1 ]?.classList.add( msg.type === "error" ? "removed" : "debug");
                        }
                    }
                }, 10 );

                this._lastShaderCompilationWithErrors = true;

                return WEBGPU_ERROR; // Stop at first error
            }
        }

        if( showFeedback )
        {
            this.setEditorErrorBorder( ERROR_CODE_SUCCESS );
        }

        if( focusCanvas )
        {
            this.gpuCanvas.focus();
        }

        this.manualCompile |= ( manualCompile ?? false );

        return WEBGPU_OK;
    },

    async shaderExists()
    {
        try {
            return await fs.getDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid );
        } catch (error) {
            // Doesn't exist...
        }
    },

    async loadBufferChannel( pass, bufferName, channel, updatePreview = false, forceCompile = false )
    {
        pass.channels[ channel ] = bufferName;

        if( forceCompile )
        {
            await this.compileShader( true, pass );
        }

        if( updatePreview )
        {
            await ui.updateShaderChannelsView( pass );
        }
    },

    async loadTextureChannelFromFile( file, channel )
    {
        const pass = this.currentPass;
        if( pass.name === "Common" )
        {
            return;
        }

        pass.channels[ channel ] = file;

        await this.createTexture( file, channel, true );

        await this.compileShader( true, pass );
    },

    async removeUniformChannel( channel )
    {
        const pass = this.currentPass;
        if( pass.name === "Common" )
            return;

        pass.channels[ channel ] = undefined;

        // Reset image
        await ui.updateShaderChannelsView( pass );

        // Recreate everything
        await this.compileShader( true, pass );
    },

    async addUniform( name, value, min, max )
    {
        const pass = this.currentPass;
        if( pass.name === "Common" )
            return;

        const uName = name ?? `iUniform${ pass.uniforms.length + 1 }`;
        pass.uniforms.push( { name: uName, type: "f32", value: value ?? 0, min: min ?? 0, max: max ?? 1 } );
        const allCode = pass.getShaderCode( false );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            await this.compileShader( true, pass );
        }
    },

    async removeUniform( pass, uniformIdx )
    {
        const uName = pass.uniforms[ uniformIdx ].name;
        // Check if the uniforms is used to recompile shaders or not
        const allCode = pass.getShaderCode( false );
        pass.uniforms.splice( uniformIdx, 1 );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            this.compileShader( true, pass );
        }
    },

    async updateUniformType( pass, uniformIdx, typeName )
    {
        const isColor = typeName.startsWith( "color" );
        typeName = isColor ? `vec${ typeName[ 5 ] }f` : typeName;
        console.log(typeName);
        const u = pass.uniforms[ uniformIdx ];
        u.type = typeName;
        u.isColor = isColor;

        if( typeName.startsWith( "vec" ) )
        {
            const size = Shader.GetUniformSize( typeName ) / 4;
            u.value = [].concat( u.value );
            for( let i = 0; i < size; ++i )
            {
                u.value[ i ] = u.value[ i ] ?? ( isColor && i == 3 ? 1 : 0 ); // add 1 as color alpha channel
            }
        }
        else // number
        {
            u.value = [].concat( u.value )[ 0 ];
        }

        // Remove this buffer to recreate it
        pass.uniformBuffers.splice( uniformIdx, 1 );

        // Check if the uniforms is used to recompile shaders or not
        const allCode = pass.getShaderCode( false );
        if( allCode.match( new RegExp( `\\b${ u.name }\\b` ) ) )
        {
            this.compileShader( true, pass );
        }
    },

    startCapture( options )
    {
        this.exportFramesCount = parseInt( options.frames ?? 120 );
        this.captureFrameCount = 1;
        this.format = options.format ?? 'gif';

        switch( this.format )
        {
            case "gif":
                this.mimeType = 'image/gif';
                break;
            case "png":
                this.mimeType = 'image/png';
                break;
            case "webm":
                this.mimeType = 'video/webm';
                break;
        }

        this.capturer = new CCapture( { format: this.format, framerate: parseInt ( options.framerate ?? 30 ), workersPath: './src/extra/' } );
        this.capturer.start();
    },

    saveCapture()
    {
        if( !this.capturer )
        {
            return;
        }

        this.capturer.stop();

        const callback = ( blob ) => {
            download( blob, `${ this.shader.name }.${ this.format }`, this.mimeType );
            delete this.capturer;
            delete this.frameCount;
            ui.onStopCapture();
            return false;
        };

        this.capturer.save( callback );

        // custom save, will get a blob in the callback
        // this.capturer.save( function( blob ) { /* ... */ } );
    },

    async snapshotCanvas( outWidth, outHeight )
    {
        const width = outWidth ?? 640;
        const height = outHeight ?? 360;
        const blob = await (() => {return new Promise((resolve) =>
            this.gpuCanvas.toBlob((blob) => resolve(blob), "image/png")
        )})();
        const bitmap = await createImageBitmap( blob );

        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = width;
        snapCanvas.height = height;
        const ctx = snapCanvas.getContext("2d");
        ctx.drawImage( bitmap, 0, 0, width, height );

        return new Promise((resolve) =>
            snapCanvas.toBlob((blob) => resolve(blob), "image/png")
        );
    },

    async getCanvasSnapshot()
    {
        const blob = await this.snapshotCanvas();
        const url = URL.createObjectURL( blob );
        window.open(url);
    },

    quitIfWebGPUNotAvailable( adapter, device )
    {
        if( !device )
        {
            return this.quitIfAdapterNotAvailable( adapter );
        }

        device.lost.then((reason) => {
            this.fail(`Device lost ("${reason.reason}"):\n${reason.message}`);
        });

        // device.addEventListener('uncapturederror', (ev) => {
        //     this.fail(`Uncaptured error:\n${ev.error.message}`);
        // });

        return WEBGPU_OK;
    },

    quitIfAdapterNotAvailable( adapter )
    {
        if( !("gpu" in navigator) )
        {
            this.fail("'navigator.gpu' is not defined - WebGPU not available in this browser");
        }
        else if( !adapter )
        {
            this.fail("No adapter found after calling 'requestAdapter'.");
        }
        else
        {
            this.fail("Unable to get WebGPU device for an unknown reason.");
        }

        return WEBGPU_ERROR;
    },

    fail( msg, msgTitle )
    {
        new LX.Dialog( msgTitle ?? "❌ WebGPU Error", (p) => {
            p.root.classList.add( "p-4" );
            p.root.innerHTML = msg;
        }, { modal: true } );
    }
}

await ShaderHub.init();

window.LX = LX;
window.fs = fs;
window.ShaderHub = ShaderHub;

export { ShaderHub };
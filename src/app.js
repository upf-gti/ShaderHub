import { LX } from 'lexgui';
import * as Constants from "./constants.js";
import * as Utils from './utils.js';
import { FS } from './fs.js';
import { ui } from './ui.js';
import { Renderer, FPSCounter, Shader, ShaderPass } from './graphics.js';

const ERROR_CODE_DEFAULT    = 0;
const ERROR_CODE_SUCCESS    = 1;
const ERROR_CODE_ERROR      = 2;

const fs =      new FS();
const fps =     new FPSCounter();
const Query =   Appwrite.Query;

const ShaderHub =
{
    version:            "1.3",

    keyState:           new Map(),
    keyToggleState:     new Map(),
    keyPressed:         new Map(),
    audioPlaying:       {},
    mousePosition:      [ 0, 0 ],
    lastMousePosition:  [ 0, 0 ],

    frameCount:         0,
    lastTime:           0,
    elapsedTime:        0,
    capturer:           null,
    generateKbTexture:  true,
    timePaused:         false,
    manualCompile:      false,
    previewNamePrefix:  '_preview_',
    imagesRootPath:     '/images/',

    async init()
    {
        this.audioContext = new AudioContext( { sampleRate: 48000 } );
        this.shaderPreviewPath = `${this.imagesRootPath}/shader_preview.png`;

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
            this.renderer.updateFrame( this.timeDelta, this.elapsedTime, this.frameCount );

            this.elapsedTime += this.timeDelta;

            this.frameCount++;

            LX.emitSignal( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
            LX.emitSignal( "@fps", `${ fps.get() } FPS` );
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
                const channel = pass.channels[ c ];
                if( !channel ) continue;
                const channelId = channel.id;

                if( !this.renderer.gpuTextures[ channelId ] )
                {
                    if( channelId === "Keyboard" )
                    {
                        await this.createKeyboardTexture( c );
                    }
                    else if( channelId.startsWith( "Buffer" ) )
                    {
                        await this.loadBufferChannel( pass, channelId, c )
                    }
                    else // Texture, cubemap or sound
                    {
                        await this.createTextureFromFile( channelId );
                    }
                }

                pass.setChannelTexture( c, this.renderer.gpuTextures[ channelId ] );
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

        for( const idx in this.audioPlaying )
        {
            const audioData = this.audioPlaying[ idx ];
            const audio = audioData.audio;
            const id = audio.id ?? '';
            if( audio.paused ) continue;

            for( let i = 0; i < this.shader.passes.length; ++i )
            {
                // Buffers and images draw
                const pass = this.shader.passes[ i ];
                if( pass.type === "common" ) continue;

                const usedChannel = pass.channels.findIndex( c => c?.id === id );
                if( usedChannel > -1 )
                {
                    await this.createAudioTexture( null, id, audio.name );
                }
            }
        }

        this._mousePressed = undefined;

        if( this.capturer )
        {
            this.capturer.capture( this.renderer.canvas );

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

    async onMouseDown( x, y, button )
    {
        this._mouseDown = parseInt( button );
        this._mousePressed = this._mouseDown;
        this.mousePosition = [ x, this.resolutionY - y ];
        this.lastMousePosition = [ ...this.mousePosition ];
    },

    async onMouseUp( e )
    {
        this._mouseDown = undefined;
    },

    async onMouseMove( x, y )
    {
        if( this._mouseDown !== undefined )
        {
            this.mousePosition = [ x, this.resolutionY - y ];
        }
    },

    async onShaderCanvasResized( xResolution, yResolution )
    {
        this.resizeBuffers( xResolution, yResolution );

        this.renderer.updateResolution( xResolution, yResolution );

        LX.emitSignal( '@resolution', `${ xResolution }x${ yResolution }` );

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
            document.body.querySelectorAll( '.lextooltip' ).forEach( e => e.remove() );

            // Destroy pass
            {
                const passIndex = this.shader.passes.findIndex( p => p.name === name );
                const pass = this.shader.passes[ passIndex ];
                if( pass.type === 'buffer' )
                {
                    delete this.renderer.gpuTextures[ pass.name ];
                }

                this.shader.passes.splice( passIndex, 1 );

                await this.compileShader();
            }
        };

        // Prob. new shader
        if( !this.shader.url )
        {
            const pass = {
                name: 'MainImage',
                type: 'image',
                codeLines: Shader.RENDER_MAIN_TEMPLATE,
                resolutionX: this.resolutionX,
                resolutionY: this.resolutionY
            }

            const shaderPass = new ShaderPass( shader, this.renderer.device, pass );
            this.shader.passes.push( shaderPass );

            // Set code in the editor
            ui.editor.addTab( pass.name, false, pass.name, { codeLines: pass.codeLines, language: "WGSL" } );
        }
        else
        {
            const json = JSON.parse( await fs.requestFile( this.shader.url, "text" ) );
            console.assert( json, "DB: No JSON Shader data available!" );

            this.shader._json = LX.deepCopy( json );

            for( const pass of json.passes ?? [] )
            {
                pass.resolutionX = this.resolutionX;
                pass.resolutionY = this.resolutionY;

                pass.uniforms = pass.uniforms ?? [];
                pass.uniforms.forEach( u => u.type = u.type ?? 'f32');

                // Push passes to the shader
                const shaderPass = new ShaderPass( shader, this.renderer.device, pass );
                if( pass.type === 'buffer' || pass.type === 'compute' )
                {
                    console.assert( shaderPass.textures, 'Buffer does not have render target textures' );
                    this.renderer.gpuTextures[ pass.name ] = shaderPass.textures;
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

        this.currentPass = this.shader.passes.at( -1 );

        // Get the total like count for the shader
        const shaderLikes = await fs.listDocuments( FS.INTERACTIONS_COLLECTION_ID, [
            Query.equal( "type", "like" ),
            Query.equal( "shader_id", this.shader.uid ?? "" )
        ] );

        // Check if the user already liked this shader
        const shaderLikesByUser = shaderLikes.documents.filter( d => d['author_id'] === ( fs.user ? fs.getUserId() : '' ) );
        const alreadyLiked = ( fs?.user && shaderLikesByUser.length > 0 ) ?? false;
        LX.emitSignal( '@on_like_changed', [ shaderLikes.total, alreadyLiked ] );

        ui.editor.loadTab( this.currentPass.name );
    },

    async onShaderLike()
    {
        const userId = fs.getUserId();

        // Update user likes and interactions table
        const users = await fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", userId ) ] );
        const user = users?.documents[ 0 ];
        console.assert( user );
        const userLikes = user[ "liked_shaders" ];
        const userLikeIndex = userLikes.indexOf( this.shader.uid );
        const wasLiked = ( userLikeIndex !== -1 );

        if( wasLiked )
        {
            userLikes.splice( userLikeIndex, 1 );

            // Search current interaction and remove it
            const doc = await fs.listDocuments( FS.INTERACTIONS_COLLECTION_ID, [
                Query.equal( "type", "like" ),
                Query.equal( "author_id", fs.getUserId() ),
                Query.equal( "shader_id", this.shader.uid )
            ] );

            if( doc.total === 0 )
            {
                console.warn( "Weird, no like interaction found to delete!" );
            }
            else
            {
                const interaction = doc?.documents[ 0 ];
                await fs.deleteDocument( FS.INTERACTIONS_COLLECTION_ID, interaction[ "$id" ] );
            }
        }
        else
        {
            userLikes.push( this.shader.uid );

            // Add interaction
            await fs.createDocument( FS.INTERACTIONS_COLLECTION_ID, {
                "type": "like",
                "author_id": fs.getUserId(),
                "shader_id": this.shader.uid,
            } );
        }

        // Get the total like count for the shader
        const shaderLikes = await fs.listDocuments( FS.INTERACTIONS_COLLECTION_ID, [
            Query.equal( "type", "like" ),
            Query.equal( "shader_id", this.shader.uid )
        ] );

        // save shader like-count
        await fs.updateDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid, {
            "like_count": shaderLikes.total
        } );

        // this is not the user id, it's the id of the user row in the users DB
        await fs.updateDocument( FS.USERS_COLLECTION_ID, user[ "$id" ], {
            "liked_shaders": userLikes
        } );

        LX.emitSignal( "@on_like_changed", [ shaderLikes.total, !wasLiked ] );
    },

    onShaderPassCreated( passType, passName )
    {
        let indexOffset = -1;

        const shaderPass = new ShaderPass( this.shader, this.renderer.device, {
            name: passName,
            type: passType,
            resolutionX: this.resolutionX,
            resolutionY: this.resolutionY
        } );

        const getNextBufferName = () => {
            const usedNames = this.shader.passes.filter( p => ( p.type === "buffer" ) || ( p.type === "compute" ) ).map( p => p.name );
            const possibleNames = ["BufferA", "BufferB", "BufferC", "BufferD"];

            // Find the first unused name
            for( const name of possibleNames )
            {
                if( !usedNames.includes( name )) return name;
            }

            // All used, should not happen due to prev checks
            return null;
        }

        if( passType === "buffer" || passType === "compute" )
        {
            indexOffset = -2;
            passName = shaderPass.name = getNextBufferName();
            this.shader.passes.splice( this.shader.passes.length - 1, 0, shaderPass ); // Add before MainImage

            console.assert( shaderPass.textures, "Buffer/Compute pass does not have render target textures" );
            this.renderer.gpuTextures[ passName ] = shaderPass.textures;
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

        ui.editor.setCustomSuggestions( this.getCurrentSuggestions() );
    },

    onShaderTimePaused()
    {
        this.timePaused = !this.timePaused;

        for( const idx in this.audioPlaying )
        {
            const audioData = this.audioPlaying[ idx ];
            const audio = audioData.audio;

            if( this.timePaused )
            {
                audio.pause();
            }
            else
            {
                audio.play();
            }
        }
    },

    onShaderTimeReset()
    {
        fps.reset();

        this.frameCount     = 0;
        this.elapsedTime    = 0;
        this.timeDelta      = 0;

        this.renderer.updateFrame( 0, 0, 0 );

        // Reset mouse data
        {
            const X = this.resolutionX ?? this.renderer.canvas.offsetWidth;
            const Y = this.resolutionY ?? this.renderer.canvas.offsetHeight;

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

        LX.emitSignal( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
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
                LX.makeContainer( ["100%", "auto"], "mt-8 text-2xl font-medium justify-center text-center", "No shader found.", this.area );
                return;
            }

            shaderData = {
                name: result.name,
                uid: id,
                url: await fs.getFileUrl( result[ "file_id" ] ),
                description: result.description ?? "",
                creationDate: Utils.toESDate( result[ "$createdAt" ] ),
                originalId: result[ "original_id" ],
                tags: result[ "tags" ],
            };

            const authorId = result[ "author_id" ];
            const ownShader = fs.user && ( authorId === fs.getUserId() );
            if( ownShader )
            {
                shaderData.author = ui.dbUser.user_name;
                shaderData.authorId = ui.dbUser.user_id;
            }
            else if( authorId )
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
                creationDate: Utils.getDate(),
                tags: []
            };
        }

        return new Shader( shaderData );
    },

    async getChannelMetadata( pass, channelIndex )
    {
        const channel = pass.channels[ channelIndex ];
        let name = channel?.id, url = null, category = channel?.category;

        if( !pass ) url = Constants.IMAGE_EMPTY_SRC;
        else
        {
            const assetFileId = channel?.id;
            if( !assetFileId ) url = Constants.IMAGE_EMPTY_SRC;
            else if( assetFileId === "Keyboard" ) url = `${ShaderHub.imagesRootPath}/keyboard.png`;
            else if( assetFileId.startsWith( "Buffer" ) ) url = `${ShaderHub.imagesRootPath}/buffer.png`;
            else if( assetFileId.startsWith( "Compute" ) ) url = `${ShaderHub.imagesRootPath}/buffer.png`; // TODO: Change preview image for computes
            else
            {
                const result = await fs.listDocuments( FS.ASSETS_COLLECTION_ID, [ Query.equal( "file_id", assetFileId ) ] );
                // console.assert( result.total == 1, `Inconsistent asset list for file id ${ assetFileId }` );
                if( result.total == 0 ) return;

                const d = result.documents[ 0 ];

                name = d.name;
                category = d.category;

                const preview = category === "sound" ? `${ShaderHub.imagesRootPath}/sound.png` : d[ "preview" ];
                if( preview )
                {
                    url = preview.includes( '/' ) ? preview : await fs.getFileUrl( preview );
                }
                else
                {
                    url = ( category === "cubemap" || category === "sound" ) ? Constants.IMAGE_EMPTY_SRC : await fs.getFileUrl( assetFileId );
                }
            }
        }

        return { url, name, category }
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
        element = element ?? this.renderer.canvas;

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

    getFullPath( addPath = true )
    {
        return window.location.origin + ( addPath ? window.location.pathname : "" );
    },

    getCurrentSuggestions()
    {
        const customSuggestions = [];

        Constants.DEFAULT_UNIFORM_NAMES.forEach( u => {
            if( u.startsWith( "iChannel" ) )
            {
                customSuggestions.push( "iChannel" );
            }
            else
            {
                customSuggestions.push( u );
            }
        } );

        // Samplers
        customSuggestions.push( "nearestSampler", "bilinearSampler", "trilinearSampler", "nearestRepeatSampler", "bilinearRepeatSampler", "trilinearRepeatSampler" );

        // Keyboard utils
        customSuggestions.push( "keyDown", "keyPressed", "keyState" );

        if( this.currentPass )
        {
            customSuggestions.push( ...this.currentPass.uniforms.map( u => u.name ) );
        }

        return customSuggestions;
    },

    getShaderPreviewName( uid )
    {
        return `${ this.previewNamePrefix }${ uid }.png`;
    },

    async saveShaderFiles( ownShader, isRemix )
    {
        const passes = ownShader ? this.shader.passes : ( this.shader._json?.passes ?? this.shader.passes );

        // Upload file and get id
        const json = {
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

        const dialog = new LX.Dialog( "Confirm Shader Data", ( p ) => {
            let shaderName = this.shader.name, isShaderPublic = false, isShaderRemixable = true;
            const textInput = p.addText( "Name", shaderName, ( v ) => {
                shaderName = v;
            }, { pattern: LX.buildTextPattern( { minLength: 3 } ) } );
            p.addSeparator();
            p.addCheckbox( "Public", isShaderPublic, ( v ) => {
                isShaderPublic = v;
            }, { nameWidth: "50%", className: "primary" } );
            p.addCheckbox( "Allow Remix", isShaderRemixable, ( v ) => {
                isShaderRemixable = v;
            }, { nameWidth: "50%", className: "primary" } );
            p.sameLine( 2 );
            p.addButton( null, "Cancel", () => dialog.close(), { width: "50%", buttonClass: "destructive" } );
            p.addButton( null, "Confirm", async () => {
                if( !shaderName.length || !textInput.valid( shaderName ) )
                {
                    return;
                }

                this.shader.name = shaderName;

                const ownShader = ( this.shader.authorId === fs.getUserId() );
                const newFileId = await this.saveShaderFiles( ownShader );

                // Create a new shader in the DB
                const result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
                    "name": shaderName,
                    "description": this.shader.description,
                    "author_id": fs.getUserId(),
                    "author_name": this.shader.author ?? "",
                    "file_id": newFileId,
                    "like_count": 0,
                    "features": this.shader.getFeatures(),
                    "remixable": isShaderRemixable,
                    "public": isShaderPublic,
                    "tags": this.shader.tags
                } );

                this.shader.uid = result[ "$id" ];

                // Upload canvas snapshot
                await this.updateShaderPreview( this.shader.uid, false );

                // Close dialog on succeed and show toast
                dialog.close();
                Utils.toast( `✅ Shader saved`, `Shader: ${ shaderName } by ${ fs.user.name }` );
            }, { width: "50%", buttonClass: "primary" } );
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
            "file_id": newFileId
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

    async deleteShader( shaderInfo )
    {
        const uid = this.shader?.uid ?? shaderInfo?.uid;
        const name = this.shader?.name ?? shaderInfo?.name;

        if( !uid || !name )
        {
            console.error( "Can't delete shader, uid or name missing." );
            return;
        }

        let result = await this.shaderExists( uid );
        if( !result )
        {
            console.error( "Can't delete shader, uid does not exist in DB." );
            return;
        }

        const innerDelete = async () => {

            // DB entry
            await fs.deleteDocument( FS.SHADERS_COLLECTION_ID, uid );

            // Shader files
            await fs.deleteFile( result[ "file_id" ] );

            // Preview
            result = await fs.listFiles( [ Query.equal( "name", this.getShaderPreviewName( uid ) ) ] );
            if( result.total > 0 )
            {
                await fs.deleteFile( result.files[ 0 ][ "$id" ] );
            }

            dialog.destroy();

            Utils.toast( `✅ Shader deleted`, `Shader: ${ name } by ${ fs.user.name }` );
        };

        const dialog = new LX.Dialog( `Delete shader: ${ name }`, (p) => {
            p.root.classList.add( "p-2" );
            p.addTextArea( null, "Are you sure? This action cannot be undone.", null, { disabled: true } );
            p.addSeparator();
            p.sameLine( 2 );
            p.addButton( null, "Cancel", () => dialog.close(), { width: "50%", buttonClass: "destructive" } );
            p.addButton( null, "Continue", innerDelete.bind( this ), { width: "50%", buttonClass: "primary" } );
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
            "like_count": 0,
            "remixable": true,
            "public": true
        } );

        // Upload canvas snapshot
        await this.updateShaderPreview( shaderUid, false );

        // Go to shader edit view with the new shader
        ui._openShader( result[ "$id" ] );
    },

    filterShaders( shaderList, querySearch )
    {
        const isTagSearch = querySearch && querySearch[ 0 ] === '#';
        const scoringShaders = shaderList.map( d => {
            let score = 0;

            if( isTagSearch )
            {
                const tag = querySearch.substring( 1 );
                score = ( d.tags ?? [] ).includes( tag ) ? 1 : 0;
            }
            else if( querySearch )
            {
                const name = d.name.toLowerCase();
                const desc = ( d.description || "" ).toLowerCase();
                const author = ( d.author_name || "" ).toLowerCase();
                const terms = querySearch.toLowerCase().split( /\s+/ );

                for( const term of terms )
                {
                    if( name.includes( term ) ) score += 6;
                    if( desc.includes( term ) ) score += 3;
                    if( author.includes( term ) ) score += 1;
                }
            }

            return { ...d, score };
        });
        
        return scoringShaders.sort( ( a, b ) => b.score - a.score );
    },

    async updateShaderPreview( shaderUid, showFeedback = true )
    {
        shaderUid = shaderUid ?? this.shader.uid;

        // Delete old preview first if necessary
        const previewName = this.getShaderPreviewName( shaderUid );
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
        this.renderer = new Renderer( canvas );

        await this.renderer.init();

        requestAnimationFrame( this.onFrame.bind( this) );
    },

    async createTextureFromFile( channelName )
    {
        const result = await fs.listDocuments( FS.ASSETS_COLLECTION_ID, [ Query.equal( "file_id", channelName ) ] );
        // console.assert( result.total == 1, `Inconsistent asset list for file id ${ channelName }` );
        if( result.total == 0 ) return;

        const url = await fs.getFileUrl( channelName );
        const data = await fs.requestFile( url );
        const asset = result.documents[ 0 ];

        let texture = null;

        if( asset.category === "cubemap" )
        {
            texture = await this.renderer.createCubemapTexture( data, channelName, asset.name );
        }
        else if( asset.category === "sound" )
        {
            texture = await this.createAudioTexture( data, channelName, asset.name );
        }
        else
        {
            texture = await this.renderer.createTexture( data, channelName, asset.name );
        }

        return texture;
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
        const imageTexture = this.renderer.gpuTextures[ imageName ] ?? this.renderer.device.createTexture({
            label: "KeyboardTexture",
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
            format: 'rgba8unorm',
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.renderer.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: imageTexture },
            dimensions
        );

        // Recreate stuff if we update the texture and
        // a shader pass is using it
        this.renderer.gpuTextures[ imageName ] = imageTexture;

        const pass = this.currentPass;
        const usedChannel = pass.channels.findIndex( c => c?.id === imageName );
        if( ( channel === undefined ) && usedChannel > -1 )
        {
            channel = usedChannel;
        }

        if( channel !== undefined )
        {
            pass.channels[ channel ] = { id: imageName, category: 'misc' };

            if( updatePreview )
            {
                await ui.updateShaderChannelsView( pass );
            }
        }
    },

    async createAudioTexture( arrayBuffer, id, label = "" )
    {
        const FFT_SIZE = 1024; // gives 512 frequency bins
        const dimensions = [ 512, 2 ];

        if ( !this.audioPlaying[ id ] )
        {
            const blob = new Blob( [ arrayBuffer ], { type: "audio/mpeg" } );
            const url = URL.createObjectURL( blob );
            const audio = new Audio();
            audio.src = url;
            audio.crossOrigin = "anonymous";
            audio.preload = "auto";
            audio.id = id;
            audio.name = label;

            const source = this.audioContext.createMediaElementSource( audio );
            const analyser = this.audioContext.createAnalyser();
            const gain = this.audioContext.createGain();

            // analyser.fftSize = FFT_SIZE;
            analyser.smoothingTimeConstant = 0.8;

            source.connect( analyser );
            analyser.connect( gain );
            gain.connect( this.audioContext.destination );

            const frequencyBinCount = analyser.frequencyBinCount;
            const freqData = new Uint8Array( frequencyBinCount );
            const timeData = new Uint8Array( frequencyBinCount );

            this.audioPlaying[ id ] = {
                audio,
                analyser,
                source,
                gain,
                freqData,
                timeData
            };

            audio.play();
        }

        const audioData = this.audioPlaying[ id ];
        audioData.analyser.getByteFrequencyData( audioData.freqData );
        audioData.analyser.getByteTimeDomainData( audioData.timeData );

        const data = [];

        // Row 0: Frequency spectrum
        for ( let i = 0; i < dimensions[ 0 ]; i++ )
        {
            const v = audioData.freqData[i];
            data.push( v, v, v, 255 );
        }

        // Row 1: Waveform
        for ( let i = 0; i < dimensions[ 0 ]; i++ )
        {
            const v = audioData.timeData[i];
            data.push( v, v, v, 255 );
        }

        const imageName = id;
        const imageData = new ImageData( new Uint8ClampedArray( data ), dimensions[ 0 ], dimensions[ 1 ] );
        const imageBitmap = await createImageBitmap( imageData );

        // TODO: make this r8unorm
        const imageTexture =
            this.renderer.gpuTextures[ imageName ] ??
            this.renderer.device.createTexture({
                label,
                size: [ imageBitmap.width, imageBitmap.height, 1 ],
                format: "rgba8unorm",
                usage:
                    GPUTextureUsage.TEXTURE_BINDING |
                    GPUTextureUsage.COPY_DST |
                    GPUTextureUsage.RENDER_ATTACHMENT,
            });

        this.renderer.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture: imageTexture },
            dimensions
        );

        // Recreate stuff if we update the texture and
        // a shader pass is using it
        this.renderer.gpuTextures[ imageName ] = imageTexture;

        return imageTexture;
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
        this._compilingShader = true;

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

            const result = await pass.compile( this.renderer );
            if( result !== Constants.WEBGPU_OK ) // error object
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

                return Constants.WEBGPU_ERROR; // Stop at first error
            }
        }

        if( showFeedback )
        {
            this.setEditorErrorBorder( ERROR_CODE_SUCCESS );
        }

        if( focusCanvas )
        {
            this.renderer.canvas.focus();
        }

        this.manualCompile |= ( manualCompile ?? false );
        this._compilingShader = false;

        return Constants.WEBGPU_OK;
    },

    async shaderExists( uid )
    {
        try {
            return await fs.getDocument( FS.SHADERS_COLLECTION_ID, uid ?? this.shader.uid );
        } catch (error) {
            // Doesn't exist...
        }
    },

    async loadBufferChannel( pass, bufferName, channel, updatePreview = false, forceCompile = false )
    {
        pass.channels[ channel ] = { id: bufferName, category: 'misc' };

        if( forceCompile )
        {
            await this.compileShader( true, pass );
        }

        if( updatePreview )
        {
            await ui.updateShaderChannelsView( pass );
        }
    },

    updateUniformChannelFilter( pass, channelIndex, filterType )
    {
        const channel = pass.channels[ channelIndex ];
        if( !channel ) return;

        channel.filter = filterType;
        pass.mustCompile = true;
    },

    updateUniformChannelWrap( pass, channelIndex, wrapType )
    {
        const channel = pass.channels[ channelIndex ];
        if( !channel ) return;

        channel.wrap = wrapType;
        pass.mustCompile = true;
    },

    closeUniformChannel( channel )
    {
        if( channel?.id && this.renderer.gpuTextures[ channel.id ] )
        {
            delete this.renderer.gpuTextures[ channel.id ];
        }

        if( channel.category === "sound" && this.audioPlaying[ channel.id ] )
        {
            const audioData = this.audioPlaying[ channel.id ];
            audioData.audio.pause();
            audioData.source.disconnect();
            audioData.analyser.disconnect();
            audioData.gain.disconnect();
            delete this.audioPlaying[ channel.id ];
        }
    },

    addUniformChannel( pass, channelIndex, channel )
    {
        const oldChannel = pass.channels[ channelIndex ];
        if( oldChannel )
        {
            // Remove texture from GPU and audio if necessary
            this.closeUniformChannel( oldChannel );
        }

        pass.channels[ channelIndex ] = channel;

        pass.mustCompile = true;
    },

    async removeUniformChannel( channelIndex )
    {
        const pass = this.currentPass;
        if( pass.name === "Common" )
            return;

        const channel = pass.channels[ channelIndex ];

        // Remove texture from GPU and audio if necessary
        this.closeUniformChannel( channel );

        pass.channels[ channelIndex ] = undefined;

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
        const allCode = pass.getShaderCode( false ).code;
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            await this.compileShader( true, pass );
        }

        ui.editor.setCustomSuggestions( this.getCurrentSuggestions() );
    },

    async removeUniform( pass, uniformIdx )
    {
        const uName = pass.uniforms[ uniformIdx ].name;
        // Check if the uniforms is used to recompile shaders or not
        const allCode = pass.getShaderCode( false ).code;
        pass.uniforms.splice( uniformIdx, 1 );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            this.compileShader( true, pass );
        }

        ui.editor.setCustomSuggestions( this.getCurrentSuggestions() );
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
        const allCode = pass.getShaderCode( false ).code;
        if( allCode.match( new RegExp( `\\b${ u.name }\\b` ) ) )
        {
            this.compileShader( true, pass );
        }
    },

    playSoundUniformChannel( channelIndex )
    {
        const pass = this.currentPass;
        const channel = pass.channels[ channelIndex ];
        if( !channel || channel.category !== "sound" )
            return;

        const audioData = this.audioPlaying[ channel.id ];
        const audio = audioData.audio;
        if( audio.paused )
        {
            audio.play();
        }
        else
        {
            audio.pause();
        }
    },

    rewindSoundUniformChannel( channelIndex )
    {
        const pass = this.currentPass;
        const channel = pass.channels[ channelIndex ];
        if( !channel || channel.category !== "sound" )
            return;

        const audioData = this.audioPlaying[ channel.id ];
        const audio = audioData.audio;
        audio.currentTime = 0;
    },

    muteSoundUniformChannel( channelIndex )
    {
        const pass = this.currentPass;
        const channel = pass.channels[ channelIndex ];
        if( !channel || channel.category !== "sound" )
            return;

        const audioData = this.audioPlaying[ channel.id ];
        const audio = audioData.audio;
        audioData.muted = !audioData.muted;
        audioData.gain.gain.value = audioData.muted ? 0.0 : 1.0; // mute output
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

    async saveComment( shaderUid, text )
    {
        await fs.createDocument( FS.INTERACTIONS_COLLECTION_ID, {
            type: "comment",
            shader_id: shaderUid,
            author_id: fs.getUserId(),
            text
        } );

        if( !text.includes( '@' ) )
        {
            return;
        }

        const regex = /(^|\s)@([a-zA-Z0-9._]+)/g;
        const users = [ ...text.matchAll(regex)].map(m => m[2] );
        if( !users.length )
        {
            return;
        }

        // Notify users for the MENTION
        // TODO

        return true;
    },

    async snapshotCanvas( outWidth, outHeight )
    {
        const width = outWidth ?? 640;
        const height = outHeight ?? 360;
        const blob = await (() => {return new Promise( resolve =>
            this.renderer.canvas.toBlob( blob => resolve( blob ), "image/png" )
        )})();
        const bitmap = await createImageBitmap( blob );

        const snapCanvas = document.createElement("canvas");
        snapCanvas.width = width;
        snapCanvas.height = height;
        const ctx = snapCanvas.getContext( '2d' );
        ctx.drawImage( bitmap, 0, 0, width, height );

        return new Promise( resolve =>
            snapCanvas.toBlob( blob => resolve( blob ), 'image/png' )
        );
    },

    async getCanvasSnapshot()
    {
        const blob = await this.snapshotCanvas();
        const url = URL.createObjectURL( blob );
        window.open( url );
    }
}

await ShaderHub.init();

window.LX = LX;
window.fs = fs;
window.ui = ui;
window.ShaderHub = ShaderHub;

export { ShaderHub };
import { LX } from 'lexgui';
// import 'lexgui/extensions/codeeditor.js';
import './extra/codeeditor.js';
import * as Constants from "./constants.js";
import * as Utils from './utils.js';
import { FS } from './fs.js';
import { ui } from './ui.js';
import { Shader, ShaderPass } from './graphics.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const ERROR_CODE_DEFAULT    = 0;
const ERROR_CODE_SUCCESS    = 1;
const ERROR_CODE_ERROR      = 2;

const fs = new FS();
const Query = Appwrite.Query;

const ShaderHub =
{
    gpuTextures: {},
    gpuBuffers: {},
    renderPipelines: [],
    renderBindGroups: [],

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
        await fs.detectAutoLogin();
        await ui.init( fs );
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
        this._mouseDown = e;
        this.mousePosition = [ e.offsetX, e.offsetY ];
        this.lastMousePosition = [ ...this.mousePosition ];
        this._mousePressed = true;
    },

    async onMouseUp( e )
    {
        this._mouseDown = undefined;
    },

    async onMouseMove( e )
    {
        if( this._mouseDown )
        {
            this.mousePosition = [ e.offsetX, e.offsetY ];
        }
    },

    async onShaderCanvasResized( xResolution, yResolution )
    {
        this.resizeBuffers( xResolution, yResolution );
        this.resolutionX = xResolution;
        this.resolutionY = yResolution;
    },

    async onShaderChannelSelected( category, name, fileId, index )
    {
        if( category === "misc" )
        {
            switch( name )
            {
                case "Keyboard":
                    await this.createKeyboardTexture( index, true );
                    break;
                case "BufferA":
                case "BufferB":
                case "BufferC":
                case "BufferD":
                    await this.loadBufferChannel( this.currentPass, name, index, true );
                    break;
            }
        }
        else if( category === "texture" ) // Use this image as a texture
        {
            await this.loadTextureChannelFromFile( fileId, index );
        }
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
                this.renderPipelines.splice( passIndex, 1 );
                this.renderBindGroups.splice( passIndex, 1 );

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

            // Set code in the editor
            ui.editor.addTab( pass.name, false, pass.name, { codeLines: pass.codeLines, language: "WGSL" } );
        }
        else
        {
            const json = JSON.parse( await fs.requestFile( this.shader.url, "text" ) );
            console.assert( json, "DB: No JSON Shader data available!" );

            for( const pass of json.passes ?? [] )
            {
                pass.resolutionX = this.resolutionX;
                pass.resolutionY = this.resolutionY;

                // Push passes to the shader
                const shaderPass = new ShaderPass( shader, this.device, pass );
                if( pass.type === "buffer" )
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

        this.currentPass = this.shader.passes.at( -1 );

        ui.editor.loadTab( this.currentPass.name );
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

        if( passType === "buffer" )
        {
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

            indexOffset = -2;
            passName = shaderPass.name = getNextBufferName();
            this.shader.passes.splice( this.shader.passes.length - 1, 0, shaderPass ); // Add before MainImage

            console.assert( shaderPass.textures, "Buffer does not have render target textures" );
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

            await this.compileShader( false );

        }, 10 );
    },

    onShaderPassSelected( passName )
    {
        this.currentPass = this.shader.passes.find( p => p.name === passName );
        console.assert( this.currentPass, `Cannot find pass ${ passName }` );
        ui.updateShaderChannelsView( this.currentPass );
    },

    onShaderTimePaused()
    {
        this.timePaused = !this.timePaused;
    },

    onShaderTimeReset()
    {
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
                creationDate: Utils.toESDate( result[ "$createdAt" ] )
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

    async getChannelUrl( pass, channel )
    {
        if( !pass ) return Constants.IMAGE_EMPTY_SRC;
        const assetFileId = pass.channels[ channel ];
        if( !assetFileId ) return Constants.IMAGE_EMPTY_SRC;
        if( assetFileId === "Keyboard" ) return "images/keyboard.png";
        if( assetFileId.startsWith( "Buffer" ) ) return "images/buffer.png";
        const result = await fs.listDocuments( FS.ASSETS_COLLECTION_ID, [ Query.equal( "file_id", assetFileId ) ] );
        console.assert( result.total == 1, `Inconsistent asset list for file id ${ assetFileId }` );
        const preview = result.documents[ 0 ][ "preview" ];
        return preview ? await fs.getFileUrl( preview ) : await fs.getFileUrl( assetFileId );
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

    requestFullscreen( element ) {

        element = element ?? this.gpuCanvas;

        if( element == null ) element = document.documentElement;
        if( element.requestFullscreen ) element.requestFullscreen();
        else if( element.msRequestFullscreen ) element.msRequestFullscreen();
        else if( element.mozRequestFullScreen ) element.mozRequestFullScreen();
        else if( element.webkitRequestFullscreen ) element.webkitRequestFullscreen( Element.ALLOW_KEYBOARD_INPUT );

        if( element.focus ) element.focus();
    },

    isFullScreen() {
        return document.fullscreen || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement;
    },

    exitFullscreen() {
        if( document.exitFullscreen ) document.exitFullscreen();
        else if( document.msExitFullscreen ) document.msExitFullscreen();
        else if( document.mozCancelFullScreen ) document.mozCancelFullScreen();
        else if( document.webkitExitFullscreen ) document.webkitExitFullscreen();
    },

    openProfile( userID ) {
        window.location.href = `${ window.location.origin + window.location.pathname }?profile=${ userID }`;
    },

    openLoginDialog() {

        const dialog = new LX.Dialog( "Login", ( p ) => {
            const formData = { email: { label: "Email", value: "", icon: "AtSign" }, password: { label: "Password", icon: "Key", value: "", type: "password" } };
            const form = p.addForm( null, formData, async (value, event) => {
                await fs.login( value.email, value.password, ( user, session ) => {
                    dialog.close();
                    const loginButton = document.getElementById( "loginOptionsButton" );
                    if( loginButton )
                    {
                        loginButton.innerHTML = `<span class="decoration-none fg-secondary">${ fs.user.email }</span>
                                                    ${ LX.makeIcon("ChevronsUpDown", { iconClass: "pl-2" } ).innerHTML }`;
                    }
                    document.getElementById( "signupContainer" )?.classList.add( "hidden" );
                    document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
                    LX.toast( `✅ Logged in`, `User: ${ value.email }`, { position: "top-right" } );
                }, (err) => {
                    LX.toast( `❌ Error`, err, { timeout: -1, position: "top-right" } );
                } );
            }, { primaryActionName: "Login" });
            form.root.querySelector( "button" ).classList.add( "mt-2" );
        }, { modal: true } );
    },

    openSignUpDialog() {

        const dialog = new LX.Dialog( "Create account", ( p ) => {

            const namePattern = LX.buildTextPattern( { minLength: Constants.USERNAME_MIN_LENGTH } );
            const passwordPattern = LX.buildTextPattern( { minLength: Constants.PASSWORD_MIN_LENGTH, digit: true } );
            const formData = {
                name: { label: "Name", value: "", icon: "User", xpattern: namePattern },
                email: { label: "Email", value: "", icon: "AtSign" },
                password: { label: "Password", value: "", type: "password", icon: "Key", xpattern: passwordPattern },
                confirmPassword: { label: "Confirm password", value: "", type: "password", icon: "Key" }
            };
            const form = p.addForm( null, formData, async (value, event) => {

                errorMsg.set( "" );

                if( !( value.name.match( new RegExp( namePattern ) ) ) )
                {
                    errorMsg.set( `❌ Name is too short. Please use at least ${ Constants.USERNAME_MIN_LENGTH } characters.` );
                    return;
                }
                else if( !( value.email.match( /^[^\s@]+@[^\s@]+\.[^\s@]+$/ ) ) )
                {
                    errorMsg.set( "❌ Please enter a valid email address." );
                    return;
                }
                else if( value.password.length < Constants.PASSWORD_MIN_LENGTH )
                {
                    errorMsg.set( `❌ Password is too short. Please use at least ${ Constants.PASSWORD_MIN_LENGTH } characters.` );
                    return;
                }
                else if( !( value.password.match( new RegExp( passwordPattern ) ) ) )
                {
                    errorMsg.set( `❌ Password must contain at least 1 digit.` );
                    return;
                }
                else if( value.password !== value.confirmPassword )
                {
                    errorMsg.set( "❌ The password and confirmation fields must match." );
                    return;
                }

                await fs.createAccount( value.email, value.password, value.name, async ( user ) => {
                    dialog.close();
                    document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
                    LX.toast( `✅ Account created!`, `You can now login with your email: ${ value.email }`, { position: "top-right" } );

                    // Update DB
                    {
                        const result = await fs.createDocument( FS.USERS_COLLECTION_ID, {
                            "user_id": user[ "$id" ],
                            "user_name": value.name
                        } );
                    }

                    this.openLoginDialog();
                }, (err) => {
                    errorMsg.set( `❌ ${ err }` );
                } );
            }, { primaryActionName: "SignUp" });
            form.root.querySelector( "button" ).classList.add( "mt-2" );
            const errorMsg = p.addTextArea( null, "", null, { inputClass: "fg-secondary", disabled: true, fitHeight: true } );
        }, { modal: true } );
    },

    createNewShader() {
        // Only crete a new shader view, nothing to save now
        window.location.href = `${ window.location.origin + window.location.pathname }?shader=new`;
    },

    async updateShaderName( shaderName ) {

        const shaderUid = this.shader.uid;

        // update DB
        // ...

        this.shader.name = shaderName;
    },

    async saveShaderFiles() {

        // Upload file and get id
        const filename = `${ LX.toCamelCase( this.shader.name ) }.json`;
        const text = JSON.stringify( {
            name: this.shader.name,
            passes: this.shader.passes
        } );
        const arraybuffer = new TextEncoder().encode( text );
        const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
        const result = await fs.createFile( file );
        return result[ "$id" ];
    },

    async saveShader( existingShader ) {

        if( !fs.user )
        {
            console.warn( "Login to save your shader!" );
            return;
        }

        if( existingShader )
        {
            this.overrideShader( existingShader );
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

                const newFileId = await this.saveShaderFiles();

                // Create a new shader in the DB
                const result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
                    "name": shaderName,
                    "description": this.shader.description,
                    "author_id": fs.getUserId(),
                    "author_name": this.shader.author ?? "",
                    "file_id": newFileId,
                } );

                this.shader.uid = result[ "$id" ];
                this.shader.name = shaderName;

                // Upload canvas snapshot
                await this.updateShaderPreview( this.shader.uid, false );

                // Close dialog on succeed and show toast
                dialog.close();
                LX.toast( `✅ Shader saved`, `Shader: ${ shaderName } by ${ fs.user.name }`, { position: "top-right" } );
            }, { width: "50%", buttonClass: "contrast" } );
        } );
    },

    async overrideShader( shaderMetadata ) {

        // Delete old file first
        const fileId = shaderMetadata[ "file_id" ];
        await fs.deleteFile( fileId );

        const newFileId = await this.saveShaderFiles();

        // Update files reference in the DB
        await fs.updateDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid, {
            "name": this.shader.name,
            "description": this.shader.description,
            "file_id": newFileId,
        } );

        // Update canvas snapshot
        await this.updateShaderPreview( this.shader.uid, false );

        LX.toast( `✅ Shader updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );
    },

    async deleteShader() {

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

            LX.toast( `✅ Shader deleted`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );

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

    async remixShader() {

        // Save the shader with you as the author id
        // Create a new col to store original_id so it can be shown in the page
        // Get the new shader id, and reload page in shader view with that id

        const shaderName = this.shader.name;
        const shaderUid = this.shader.uid;
        const newFileId = await this.saveShaderFiles();

        // Create a new shader in the DB
        result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
            "name": shaderName,
            "author_id": fs.getUserId(),
            "original_id": shaderUid,
            "file_id": newFileId,
            "description": this.shader.description
        } );

        // Upload canvas snapshot
        await this.updateShaderPreview( shaderUid, false );

        // Go to shader edit view with the new shader
        window.location.href = `${ window.location.origin + window.location.pathname }?shader=${ result[ "$id" ] }`;
    },

    async updateShaderPreview( shaderUid, showFeedback = true ) {

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
            LX.toast( `✅ Shader preview updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );
        }
    },

    async initGraphics( canvas ) {

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
                size: 16,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });
        }

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        const frame = async () => {

            const now = LX.getTime();

            this.timeDelta = ( now - this.lastTime ) / 1000;

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
            }
            this.device.queue.writeBuffer(
                this.gpuBuffers[ "resolution" ],
                0,
                new Float32Array([ this.resolutionX ?? this.gpuCanvas.offsetWidth, this.resolutionY ?? this.gpuCanvas.offsetHeight ])
            );

            this.device.queue.writeBuffer(
                this.gpuBuffers[ "mouse" ],
                0,
                new Float32Array([
                    this.mousePosition[ 0 ], this.mousePosition[ 1 ],
                    this.lastMousePosition[ 0 ] * ( this._mouseDown ? 1.0 : -1.0 ), this.lastMousePosition[ 1 ] * ( this._mousePressed ? 1.0 : -1.0 ) ])
            );

            this.lastTime = now;

            for( let i = 0; i < this.shader.passes.length; ++i )
            {
                // Buffers and images draw
                const pass = this.shader.passes[ i ];
                if( pass.type === "common" ) continue;

                // Create uniform buffers if necessary
                for( let c = 0; c < pass.channels?.length ?? 0; ++c )
                {
                    const isCurrentPass = ( this.currentPass.name === pass.name );
                    const channelName = pass.channels[ c ];
                    if( !channelName || this.gpuTextures[ channelName ] ) continue; // undefined or already created

                    if( channelName === "Keyboard" )
                    {
                        await this.createKeyboardTexture( c, true );
                        continue;
                    }
                    else if( channelName.startsWith( "Buffer" ) )
                    {
                        await this.loadBufferChannel( pass, channelName, c, isCurrentPass )
                        continue;
                    }

                    // Only update preview in case that's the current pass
                    await this.createTexture( channelName, c, isCurrentPass );
                }

                if( this._parametersDirty && pass.uniforms.length )
                {
                    pass.uniforms.map( ( u, index ) => {
                        this.device.queue.writeBuffer(
                            pass.uniformBuffers[ index ],
                            0,
                            new Float32Array([ u.value ])
                        );
                    } );

                    this._parametersDirty = false;
                }

                if( !this._lastShaderCompilationWithErrors )
                {
                    if( !this.renderPipelines[ i ] )
                    {
                        await this.compileShader( true, pass );
                    }

                    // Move bindgroups and pipelines to each pass
                    // and remove this debug per-frame recreastion of BG
                    // const bg = await this.createRenderBindGroup( pass, this.renderPipelines[ i ] );

                    const r = pass.draw(
                        this.device,
                        this.webGPUContext,
                        this.renderPipelines[ i ],
                        this.renderBindGroups[ i ]
                    );

                    // Update buffers
                    if( pass.type === "buffer" )
                    {
                        this.gpuTextures[ pass.name ] = r;
                    }
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

            requestAnimationFrame( frame );
        }

        requestAnimationFrame( frame );
    },

    async createRenderPipeline( pass, updateBindGroup = true ) {

        if( pass.type === "common" ) return;

        const result = await this.validateShader( pass.getShaderCode() );
        if( !result.valid )
        {
            return result;
        }

        const renderPipeline = await this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: result.module,
            },
            fragment: {
                module: result.module,
                targets: [
                    {
                        format: this.presentationFormat,
                    },
                ],
            },
            primitive: {
                topology: 'triangle-list',
            },
        });

        console.warn( "Info: Render Pipeline created!" );

        if( updateBindGroup )
        {
            return [ renderPipeline, await this.createRenderBindGroup( pass, renderPipeline ) ];
        }
        else
        {
            return renderPipeline;
        }
    },

    async createRenderBindGroup( pass, renderPipeline ) {

        if( !renderPipeline )
        {
            return;
        }

        let bindingIndex = 0;

        const entries = [
            {
                binding: bindingIndex++,
                resource: { buffer: this.gpuBuffers[ "time" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.gpuBuffers[ "timeDelta" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.gpuBuffers[ "frameCount" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.gpuBuffers[ "resolution" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.gpuBuffers[ "mouse" ] }
            }
        ]

        const customUniformCount = pass.uniforms.length;
        if( customUniformCount )
        {
            pass.uniforms.map( ( u, index ) => {
                const buffer = pass.uniformBuffers[ index ];
                this.device.queue.writeBuffer(
                    buffer,
                    0,
                    new Float32Array([ u.value ])
                );
                entries.push( {
                    binding: bindingIndex++,
                    resource: {
                        buffer,
                    }
                } );
            } );
        }

        const bindings = pass.channels.filter( u => u !== undefined && this.gpuTextures[ u ] );

        if( bindings.length )
        {
            entries.push( ...pass.channels.map( ( channelName, index ) => {
                if( !channelName ) return;
                let texture = this.gpuTextures[ channelName ];
                if( !texture ) return;
                texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_BIND_TEXTURE_INDEX ] : texture;
                return { binding: bindingIndex++, resource: texture.createView() };
            } ).filter( u => u !== undefined ) );
            entries.push( { binding: bindingIndex++, resource: this.sampler } );
        }

        const renderBindGroup = await this.device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout( 0 ),
            entries
        });

        console.warn( "Info: Render Bind Group created!" );

        return renderBindGroup;
    },

    async createTexture( fileId, channel, updatePreview = false, options = { } ) {

        if( !fileId )
        {
            return;
        }

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
            ui.updateShaderChannelPreview( channel, url );
        }

        return imageTexture;
    },

    async createKeyboardTexture( channel, updatePreview )
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

        const imageData = new ImageData( new Uint8ClampedArray( data ), dimensions[ 0 ], dimensions[ 1 ] );
        const imageBitmap = await createImageBitmap( imageData );
        const imageTexture = this.device.createTexture({
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
        const imageName = "Keyboard";
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

            const passIndex = this.shader.passes.indexOf( pass );
            this.renderPipelines[ passIndex ] = null;
            this.renderBindGroups[ passIndex ] = null;

            // await this.compileShader( false, pass );

            if( updatePreview )
            {
                ui.updateShaderChannelPreview( channel, "images/keyboard.png" );
            }
        }
    },

    async validateShader( code )
    {
        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

        // Validate shader
        const module = this.device.createShaderModule({ code });
        const info = await module.getCompilationInfo();

        if( info.messages.length > 0 )
        {
            let errorMsgs = [];

            for( const msg of info.messages )
            {
                if( msg.type === "error" )
                {
                    errorMsgs.push( msg );
                }
            }

            if( errorMsgs.length > 0 )
            {
                return { valid: false, code, messages: errorMsgs };
            }
        }

        return { valid: true, module };
    },

    setEditorErrorBorder( errorCode = ERROR_CODE_DEFAULT )
    {
        ui.editor.area.root.parentElement.classList.toggle( "code-border-default", errorCode === ERROR_CODE_DEFAULT );
        ui.editor.area.root.parentElement.classList.toggle( "code-border-error", errorCode === ERROR_CODE_ERROR );
        ui.editor.area.root.parentElement.classList.toggle( "code-border-success", errorCode === ERROR_CODE_SUCCESS );

        LX.doAsync( () => this.setEditorErrorBorder(), 2000 );
    },

    async compileShader( showFeedback = true, pass )
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

            const passIndex = this.shader.passes.indexOf( pass );
            const pipeline = await this.createRenderPipeline( pass, false );
            if( pipeline.constructor === GPURenderPipeline ) // success, no errors
            {
                this.renderPipelines[ passIndex ] = pipeline;
                this.renderBindGroups[ passIndex ] = await this.createRenderBindGroup( pass, pipeline );
            }
            else if( pipeline ) // error object
            {
                // Open the tab with the error
                ui.editor.loadTab( pass.name );

                // Make async so the tab is opened before adding the error feedback
                LX.doAsync( () => {

                    const mainImageLineOffset = pipeline.code.split( "\n" ).indexOf( pass.codeLines[ 0 ] );
                    console.assert( mainImageLineOffset > 0 );

                    for( const msg of pipeline.messages )
                    {
                        const fragLineNumber = msg.lineNum - ( mainImageLineOffset );

                        if( showFeedback )
                        {
                            this.setEditorErrorBorder( ERROR_CODE_ERROR );
                            LX.toast( `❌ ${ LX.toTitleCase( msg.type ) }: ${ fragLineNumber }:${ msg.linePos }`, msg.message, { timeout: -1, position: "top-right" } );
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
            // LX.toast( `✅ No errors`, "Shader compiled successfully!", { position: "top-right" } );
        }

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
            ui.updateShaderChannelPreview( channel, "images/buffer.png" );
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
        ui.updateShaderChannelPreview( channel, Constants.IMAGE_EMPTY_SRC );

        // Recreate everything
        await this.compileShader( true, pass );
    },

    async addUniform( name, value, min, max )
    {
        const pass = this.currentPass;
        if( pass.name === "Common" )
            return;

        const uName = name ?? `iUniform${ pass.uniforms.length + 1 }`;
        pass.uniforms.push( { name: uName, value: value ?? 0, min: min ?? 0, max: max ?? 1 } );
        const allCode = pass.getShaderCode( false );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            await this.createRenderPipeline( pass, true );
        }
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
window.ShaderHub = ShaderHub;

export { ShaderHub };
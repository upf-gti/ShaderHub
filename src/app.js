import { LX } from 'lexgui';
import 'lexgui/extensions/codeeditor.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const UNIFORM_CHANNELS_COUNT = 4;

const UNIFORM_CHANNEL_0 = 0;
const UNIFORM_CHANNEL_1 = 1;
const UNIFORM_CHANNEL_2 = 2;
const UNIFORM_CHANNEL_3 = 3;

const ShaderHub = {

    loadedFiles: {},
    loadedImages: {},
    uniformChannels: [],

    async initUI() {

        let area = await LX.init();

        const starterTheme = LX.getTheme();
        const menubar = area.addMenubar([
            {
                name: "New", callback: () => {}
            },
            {
                name: "Browse", callback: () => {}
            },
        ]);

        const searchButton = new LX.Button(null, 
            `<span class="px-2 mr-auto">Search shaders...</span>`,
            () => { },
            { width: "256px", className: "right", buttonClass: "border fg-tertiary bg-secondary" }
        );
        menubar.root.appendChild( searchButton.root );

        menubar.addButtons([
            {
                title: "Switch Theme",
                icon: starterTheme == "dark" ? "Moon" : "Sun",
                swap: starterTheme == "dark" ? "Sun" : "Moon",
                callback: (value, event) => { LX.switchTheme() }
            }
        ]);

        menubar.setButtonImage("ShaderHub", `../images/icon_${ starterTheme }.png`, null, { float: "left" } );
        menubar.setButtonIcon("Github", "Github@solid", () => { window.open("https://github.com/upf-gti/ShaderHub") } );

        var [ leftArea, rightArea ] = area.split({ sizes: ["55%", "45%"] });
        leftArea.onresize = function (bounding) {
            
        };

        var [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", null], resize: false });

        // Add input channels UI
        {
            this.channelsContainer = LX.makeContainer( ["100%", "100%"], "p-2 flex flex-row gap-2 items-center justify-center bg-primary", "", shaderSettingsArea );
            for( let i = 0; i < UNIFORM_CHANNELS_COUNT; i++ )
            {
                const channelContainer = LX.makeContainer( [`${ 100 / UNIFORM_CHANNELS_COUNT }%`, "80%"], "relative rounded-lg bg-secondary hover:bg-tertiary cursor-pointer", "", this.channelsContainer );
                const channelImage = LX.makeElement( "img", "rounded-lg bg-secondary hover:bg-tertiary w-full h-full border-none", "", channelContainer );
                channelImage.src = "data:image/gif;base64,R0lGODlhAQABAPcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAAP8ALAAAAAABAAEAAAgEAP8FBAA7";
                const channelTitle = LX.makeContainer( ["100%", "auto"], "p-2 absolute text-md bottom-0 channel-title pointer-events-none", `iChannel${ i }`, channelContainer );
                channelContainer.addEventListener( "click", ( e ) => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    document.body.appendChild( input );
                    input.click();
                    input.addEventListener('change', async ( e ) => {
                        if( e.target.files[ 0 ] )
                        {
                            await this.loadChannelFromFile( e.target.files[ 0 ], i );
                        }
                        input.remove();
                    });
                } );
                channelContainer.addEventListener("dragover", (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy"; // shows a copy cursor
                });

                channelContainer.addEventListener("drop", async ( e ) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (!file) return;
                    if (file.type.startsWith("image/")) {
                        await this.loadChannelFromFile( file, i );
                    } else {
                        console.warn("Dropped file is not an image:", file.type);
                    }
                });

                channelContainer.addEventListener("contextmenu", ( e ) => {
                    e.preventDefault();
                    new LX.DropdownMenu( e.target, [
                        { name: "Remove", className: "fg-error", callback: async () => await this.removeUniformChannel( i ) },
                    ], { side: "top", align: "start" });
                });
            }
        }

        const files = [
            "shaders/fullscreenTexturedQuad.template.wgsl",
            "shaders/image.wgsl"
        ]

        this.editor = new LX.CodeEditor( codeArea, {
            allowAddScripts: false,
            fileExplorer: false,
            files: files.slice( 1 ),
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            onsave: async ( code ) => {
                this.editor.processLines();
                const currentTab = `shaders/${ this.editor.getSelectedTabName() }`;
                this.loadedFiles[ currentTab ] = code;
                await this.createRenderPipeline( true, true );
            }
        });

        const canvas = document.createElement("canvas");
        canvas.className = "w-full h-full";
        leftArea.attach( canvas );

        canvas.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy"; // shows a copy cursor
        });

        canvas.addEventListener("drop", async (e) => {
            e.preventDefault();

            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (file.type.startsWith("image/")) {
                await this.createTexture( file, UNIFORM_CHANNEL_0 );
                await this.createRenderBindGroup();
            } else {
                console.warn("Dropped file is not an image:", file.type);
            }
        });

        let loaded = 0;
        for( const f of files )
        {
            LX.requestText( f, async (code) => {
                this.loadedFiles[ f ] = code;
                loaded++;
                if( loaded == files.length )
                {
                    await this.initGraphics(canvas);
                }
            });
        }
    },

    async initGraphics( canvas ) {

        this.adapter = await navigator.gpu?.requestAdapter({
            featureLevel: 'compatibility',
        });

        this.device = await this.adapter?.requestDevice();
        if( this.quitIfWebGPUNotAvailable( this.adapter, this.device ) === WEBGPU_ERROR )
        {
            return;
        }

        this.webGPUContext = canvas.getContext('webgpu');

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
            // this.parametersBuffer = this.device.createBuffer({
            //     size: 4,
            //     usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            // });

            this.timeBuffer = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });
        }

        // Load texture
        {
            await this.createTexture( "images/kimetsu.png", UNIFORM_CHANNEL_0 );
        }

        // Create render pipeline based on editor shaders
        {
            await this.createRenderPipeline( false, true );
        }

        // Create bind group
        {
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            await this.createRenderBindGroup();
        }

        const frame = () => {

            this.device.queue.writeBuffer(
                this.timeBuffer,
                0,
                new Float32Array([ LX.getTime() ])
            );

            if( this.fullscreenQuadPipeline )
            {
                const commandEncoder = this.device.createCommandEncoder();
                const textureView = this.webGPUContext.getCurrentTexture().createView();

                const renderPassDescriptor = {
                    colorAttachments: [
                        {
                            view: textureView,
                            clearValue: [0, 0, 0, 1],
                            loadOp: 'clear',
                            storeOp: 'store',
                        },
                    ],
                };

                const passEncoder = commandEncoder.beginRenderPass( renderPassDescriptor );
                passEncoder.setPipeline( this.fullscreenQuadPipeline );

                if( this.renderBindGroup )
                {
                    passEncoder.setBindGroup( 0, this.renderBindGroup );
                }

                passEncoder.draw( 6 );
                passEncoder.end();

                this.device.queue.submit( [ commandEncoder.finish() ] );
            }

            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    },

    async createRenderPipeline( updateBindGroup = true, showFeedback ) {

        const templateCodeLines = this.loadedFiles[ "shaders/fullscreenTexturedQuad.template.wgsl" ].replaceAll( '\r', '' ).split( "\n" );

        // Process texture bindings
        {
            const textureBindingsIndex = templateCodeLines.indexOf( "$texture_bindings" );
            console.assert( textureBindingsIndex > -1 );
            templateCodeLines.splice( textureBindingsIndex, 1, ...[
                `@group(0) @binding(1) var texSampler : sampler;`,
                ...this.uniformChannels.filter( u => u !== undefined ).map( ( u, index ) => `@group(0) @binding(${ 2 + index }) var iChannel${ index } : texture_2d<f32>;` )
            ] );
        }

        // Process texture dummies so using it isn't mandatory
        {
            const textureDummiesIndex = templateCodeLines.indexOf( "$texture_dummies" );
            console.assert( textureDummiesIndex > -1 );
            templateCodeLines.splice( textureDummiesIndex, 1, ...[
                ...this.uniformChannels.filter( u => u !== undefined ).map( ( u, index ) => `    let channel${ index }Dummy: vec4f = textureSample(iChannel${ index }, texSampler, fragUV);` )
            ] );
        }

        // Add main image
        {
            const mainImageIndex = templateCodeLines.indexOf( "$main_image" );
            console.assert( mainImageIndex > -1 );
            const mainImageLines = this.loadedFiles[ "shaders/image.wgsl" ].replaceAll( '\r', '' ).split( "\n" );
            templateCodeLines.splice( mainImageIndex, 1, ...mainImageLines );
        }

        const result = await this.validateShader( templateCodeLines.join( "\n" ), showFeedback );
        if( !result.valid )
        {
            return;
        }

        this.fullscreenQuadPipeline = this.device.createRenderPipeline({
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

        if( updateBindGroup )
        {
            this.createRenderBindGroup();
        }
    },

    async createRenderBindGroup() {

        if( !this.fullscreenQuadPipeline )
        {
            return;
        }

        const entries = [
            {
                binding: 0,
                resource: {
                    buffer: this.timeBuffer,
                }
            }
        ]

        if( this.uniformChannels.length )
        {
            entries.push( { binding: 1, resource: this.sampler } );
            entries.push( ...this.uniformChannels.filter( u => u !== undefined ).map( ( u, index ) => { return { binding: 2 + index, resource: u.createView() } } ) );
        }

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.fullscreenQuadPipeline.getBindGroupLayout( 0 ),
            entries
        });
    },

    async createTexture( imageData, channel ) {

        const isFile = ( imageData.constructor === File );
        const data = isFile ? imageData : await this.requestFile( imageData );
        const path = isFile ? imageData.name : imageData;
        const imageBitmap = await createImageBitmap( await new Blob([data]) );
        const dimensions = [ imageBitmap.width, imageBitmap.height ];
        const imageTexture = this.device.createTexture({
            size: [  imageBitmap.width, imageBitmap.height, 1],
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

        this.loadedImages[ path ] = imageTexture;

        if( channel !== undefined )
        {
            this.uniformChannels[ channel ] = imageTexture;

            if( isFile )
            {
                var reader = new FileReader();
                reader.onloadend = () => {
                    this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = reader.result;
                }
                reader.readAsDataURL( data );
            }
            else
            {
                this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = path;
            }
        }

        return imageTexture;
    },

    async validateShader( code, showFeedback ) {

        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

        // Validate shader
        const module = this.device.createShaderModule({ code });
        const info = await module.getCompilationInfo();

        if( info.messages.length > 0 )
        {
            let hasError = false;

            const codeLines = code.split( '\n' );
            const mainImageLines = this.loadedFiles[ "shaders/image.wgsl" ].replaceAll( '\r', '' ).split( "\n" );
            const mainImageLineOffset = codeLines.indexOf( mainImageLines[ 0 ] );
            console.assert( mainImageLineOffset > 0 );

            for( const msg of info.messages )
            {
                const fragLineNumber = msg.lineNum - ( mainImageLineOffset );

                if( showFeedback )
                {
                    LX.toast( `❌ ${ LX.toTitleCase( msg.type ) }: ${ fragLineNumber }:${ msg.linePos }`, msg.message, { timeout: -1 } );
                    this.editor.code.childNodes[ fragLineNumber - 1 ]?.classList.add( msg.type === "error" ? "removed" : "debug");
                }

                if( msg.type === "error" )
                {
                    hasError = true;
                }
            }

            if( hasError )
            {
                return { valid: false, messages: info.messages };
            }
        }

        if( showFeedback )
        {
            LX.toast( `✅ No errors`, "Shader compiled successfully!" );
        }

        return { valid: true, module };
    },

    async loadChannelFromFile( file, channel ) {

        const mustUpdateRenderPipeline = ( this.uniformChannels[ channel ] === undefined );

        await this.createTexture( file, channel );

        if( mustUpdateRenderPipeline )
        {
            // This already recreates bind group
            await this.createRenderPipeline();
        }
        else
        {
            await this.createRenderBindGroup();
        }
    },

    async removeUniformChannel( channel ) {

        this.uniformChannels[ channel ] = undefined;

        // Reset image
        this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = "data:image/gif;base64,R0lGODlhAQABAPcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAAP8ALAAAAAABAAEAAAgEAP8FBAA7";

        // Recreate everything
        await this.createRenderPipeline( true, true );
    },

    quitIfWebGPUNotAvailable( adapter, device ) {

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

    quitIfAdapterNotAvailable( adapter ) {

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

    fail( msg, msgTitle ) {

        new LX.Dialog( msgTitle ?? "❌ WebGPU Error", (p) => {
            p.root.classList.add( "p-4" );
            p.root.innerHTML = msg;
        }, { modal: true } );
    },

    requestFile( url, dataType, nocache ) {

        return new Promise( (resolve, reject) => {
            dataType = dataType ?? "arraybuffer";
            const mimeType = dataType === "arraybuffer" ? "application/octet-stream" : undefined;
            var xhr = new XMLHttpRequest();
            xhr.open( 'GET', url, true );
            xhr.responseType = dataType;
            if( mimeType )
                xhr.overrideMimeType( mimeType );
            if( nocache )
                xhr.setRequestHeader('Cache-Control', 'no-cache');
            xhr.onload = function(load)
            {
                var response = this.response;
                if( this.status != 200)
                {
                    var err = "Error " + this.status;
                    reject(err);
                    return;
                }
                resolve( response );
            };
            xhr.onerror = function(err) {
                reject(err);
            };
            xhr.send();
            return xhr;
        });
    }
}

await ShaderHub.initUI();

window.LX = LX;
window.ShaderHub = ShaderHub;
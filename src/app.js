import { LX } from 'lexgui';
import 'lexgui/extensions/codeeditor.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const ShaderHub = {

    loadedFiles: {},
    loadedImages: {},
    lastLoadedImage: null,

    async initUI() {

        let area = await LX.init();

        var [ leftArea, rightArea ] = area.split({ sizes: ["55%", "45%"] });
        leftArea.onresize = function (bounding) {
            
        };

        const files = [
            "shaders/fullscreenTexturedQuad.vert.wgsl",
            "shaders/frag.wgsl"
        ]

        this.editor = new LX.CodeEditor( rightArea, {
            allowAddScripts: false,
            fileExplorer: false,
            files: files.slice( 1 ),
            onsave: async ( code ) => {
                const currentTab = `shaders/${ this.editor.getSelectedTabName() }`;
                this.loadedFiles[ currentTab ] = code;
                await this.createRenderPipeline();
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
                const imageTexture = await this.createTexture( file );
                await this.createRenderBindGroup( imageTexture );
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

        await this.createRenderPipeline( false );

        // Load texture
        {
            this.sampler = this.device.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
            });

            const imageTexture = await this.createTexture( "images/kimetsu.png" );
            await this.createRenderBindGroup( imageTexture );
        }

        const frame = () => {

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

    async createRenderPipeline( updateBindGroup = true ) {

        const shadersCode = [
            this.loadedFiles[ "shaders/fullscreenTexturedQuad.vert.wgsl" ],
            this.loadedFiles[ "shaders/frag.wgsl" ]
        ].join( '\n\n' );

        const result = await this.validateShader( shadersCode );
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

    async createRenderBindGroup( imageTexture ) {

        if( !this.fullscreenQuadPipeline )
        {
            return;
        }

        if( !imageTexture )
        {
            imageTexture = this.lastLoadedImage;
        }

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.fullscreenQuadPipeline.getBindGroupLayout( 0 ),
            entries: [
                {
                    binding: 0,
                    resource: this.sampler,
                },
                {
                    binding: 1,
                    resource: imageTexture.createView()
                }
            ],
        });
    },

    async createTexture( imageData ) {

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
        this.lastLoadedImage = imageTexture;

        return imageTexture;
    },

    async validateShader( code ) {

        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

        // Validate shader
        const module = this.device.createShaderModule({ code });
        const info = await module.getCompilationInfo();

        if( info.messages.length > 0 )
        {
            let hasError = false;
            for( const msg of info.messages )
            {
                LX.toast( `❌ ${msg.type}: ${msg.lineNum}:${msg.linePos}`, msg.message, { timeout: -1 } );

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

        LX.toast( `✅ No errors`, "Shader compiled successfully!" );

        return { valid: true, module };
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
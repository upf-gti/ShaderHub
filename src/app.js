import { LX } from 'lexgui';
import 'lexgui/extensions/codeeditor.js';

window.LX = LX;

const ShaderHub = {

    loadedFiles: {},

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
        // quitIfWebGPUNotAvailable(this.adapter, device);

        this.webGPUContext = canvas.getContext('webgpu');

        const devicePixelRatio = window.devicePixelRatio;
        canvas.width = canvas.clientWidth * devicePixelRatio;
        canvas.height = canvas.clientHeight * devicePixelRatio;

        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.webGPUContext.configure({
            device: this.device,
            format: this.presentationFormat,
        });

        await this.createRenderPipeline();

        // const sampler = this.device.createSampler({
        //     magFilter: 'linear',
        //     minFilter: 'linear',
        // });

        const frame = () => {
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

            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
            passEncoder.setPipeline(this.fullscreenQuadPipeline);
            passEncoder.draw(6);
            passEncoder.end();

            this.device.queue.submit([commandEncoder.finish()]);
            requestAnimationFrame(frame);
        }

        requestAnimationFrame(frame);
    },

    async createRenderPipeline() {

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
    },

    async validateShader( code ) {

        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

        // Validate shader
        const module = this.device.createShaderModule({ code });
        const info = await module.getCompilationInfo();
        console.log(info)

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
    }
}

await ShaderHub.initUI();




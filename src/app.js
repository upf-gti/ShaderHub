import { LX } from 'lexgui';
import 'lexgui/extensions/codeeditor.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const UNIFORM_CHANNELS_COUNT = 4;

const SRC_IMAGE_EMPTY = "data:image/gif;base64,R0lGODlhAQABAPcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAAP8ALAAAAAABAAEAAAgEAP8FBAA7";

class Shader {

    constructor( data ) {

        this.name = data.name ?? "";
        this.uid = data.uid ?? "";
        this.files = data.files ?? [];
        this.channels = data.channels ?? [];

        this.author = data.author ?? "anonymous";
        this.description = data.description ?? "";
        this.lastUpdatedDate = "";
        this.hasPreview = data.hasPreview ?? false
    }
}

const ShaderHub = {

    loadedFiles: {},
    loadedImages: {},
    uniformChannels: [],

    lastTime: 0,
    elapsedTime: 0,
    timePaused: false,

    async initUI() {

        this.area = await LX.init();

        const starterTheme = LX.getTheme();
        const menubar = this.area.addMenubar([
            {
                name: "New", callback: () => this.createNewShader()
            },
            {
                name: "Browse", callback: () => window.location.href = `${ window.location.origin + window.location.pathname }`
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

        menubar.setButtonImage("ShaderHub", `images/icon_${ starterTheme }.png`, null, { float: "left" } );
        menubar.setButtonIcon("Github", "Github@solid", () => { window.open("https://github.com/upf-gti/ShaderHub") } );

        LX.addSignal( "@on_new_color_scheme", ( el, value ) => {
            menubar.setButtonImage("ShaderHub", `images/icon_${ value }.png`, null, { float: "left" } );
        } );

        menubar.siblingArea.root.classList.add( "content-area" );

        const onLoad = () => {
            const params = new URLSearchParams( document.location.search );
            const queryShader = params.get( "view" );
            if( queryShader )
            {
                this.createShaderView( queryShader );
            }
            else
            {
                this.createBrowseListUI();
            }
        }

        LX.requestJSON( "shader_db.json", ( json ) => {
            this.shaderList = json.sort( ( a, b ) => {
                if( !a.hasPreview ) return 1; // REMOVE THIS ONCE EVERYTHING HAS PREVIEWS
                return a.name.localeCompare( b.name );
            } );
            onLoad();
        }, ( error ) => {
            console.error( error )
            onLoad();
        });
    },

    createBrowseListUI() {

        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.className += " overflow-scroll";
        bottomArea.root.className += " items-center content-center";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 ", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea, {
            fontFamily: "var(--global-code-font)"
        } );

        const listContainer = LX.makeContainer( ["100%", "auto"], "grid shader-list gap-8 p-8 justify-center", "", topArea );

        for( const shader of this.shaderList ?? [] )
        {
            const shaderItem = LX.makeElement( "li", "shader-item rounded-lg bg-secondary hover:bg-tertiary cursor-pointer overflow-hidden flex flex-col h-auto", "", listContainer );
            const shaderPreview = LX.makeElement( "img", "rounded-t-lg bg-secondary hover:bg-tertiary w-full border-none", "", shaderItem );
            shaderPreview.src = shader.hasPreview ? `previews/${ shader.name.replaceAll(" ", "_") }_preview.png` : "previews/shader_preview.png";
            const shaderDesc = LX.makeContainer( ["100%", "100%"], "flex flex-row rounded-b-lg gap-6 p-4 items-center", `
                <div class="w-full">
                    <div class="text-lg font-bold"><span style="font-family:var(--global-code-font);">${ shader.name }</span></div>
                    <div class="text-sm font-light"><span style="font-family:var(--global-code-font);">by
                        <a href=""><span class="font-bold" style="text-decoration:underline">${ shader.author }</span></a></span>
                    </div>
                </div>
                <div class=""><a href="">
                    <div class="">
                        ${ LX.makeIcon( "CircleUserRound", { svgClass: "xxl fg-secondary" } ).innerHTML }
                    </div>
                </a></div>`, shaderItem );
                // <img alt="avatar" width="32" height="32" decoding="async" data-nimg="1" class="rounded-full" src="https://imgproxy.compute.toys/insecure/width:64/plain/https://hkisrufjmjfdgyqbbcwa.supabase.co/storage/v1/object/public/avatar/f91bbd73-7734-49a9-99ce-460774d4ccc0/avatar.jpg">

            shaderItem.addEventListener( "click", ( e ) => {
                window.location.href = `${ window.location.origin + window.location.pathname }?view=${ shader.uid }`;
            } );
        }

        if( listContainer.childElementCount === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
        }
    },

    createShaderView( shaderUid ) {

        var [ leftArea, rightArea ] = this.area.split({ sizes: ["50%", "50%"] });
        rightArea.root.className += " p-4";
        leftArea.root.className += " p-4";
        leftArea.onresize = function (bounding) {
            
        };

        var [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", null], resize: false });
        codeArea.root.className += " rounded-lg overflow-hidden";

        // Add input channels UI
        {
            this.channelsContainer = LX.makeContainer( ["100%", "100%"], "flex flex-row gap-2 items-center justify-center bg-primary", "", shaderSettingsArea );
            for( let i = 0; i < UNIFORM_CHANNELS_COUNT; i++ )
            {
                const channelContainer = LX.makeContainer( [`${ 100 / UNIFORM_CHANNELS_COUNT }%`, "80%"], "relative rounded-lg bg-secondary hover:bg-tertiary cursor-pointer", "", this.channelsContainer );
                const channelImage = LX.makeElement( "img", "rounded-lg bg-secondary hover:bg-tertiary w-full h-full border-none", "", channelContainer );
                channelImage.src = SRC_IMAGE_EMPTY;
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

        const shaderData = this.shaderList.filter( s => s.uid === shaderUid )[ 0 ];
        if( !shaderData )
        {
            return;
        }

        this.shader = new Shader( shaderData );

        document.title = `${ this.shader.name } - ShaderHub`;

        this.editor = new LX.CodeEditor( codeArea, {
            allowAddScripts: false,
            fileExplorer: false,
            files: this.shader.files,
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            onsave: async ( code ) => {
                this.editor.processLines();
                const currentTab = `shaders/${ this.editor.getSelectedTabName() }`;
                this.loadedFiles[ currentTab ] = code;
                await this.createRenderPipeline( true, true );
            },
            onFilesLoaded: async () => {

                for( const f of this.shader.files )
                {
                    const name = f.substring( f.lastIndexOf( "/" ) + 1 );
                    this.loadedFiles[ f ] = this.editor.loadedTabs[ name ].lines.join( "\n" );
                }

                editor.processLines();

                const templateShaderUrl = "shaders/fullscreenTexturedQuad.template.wgsl";
                LX.requestText( templateShaderUrl, async (code) => {

                    this.loadedFiles[ templateShaderUrl ] = code;

                    await this.initGraphics( canvas );
                });
            }
        });

        var [ graphicsArea, shaderDataArea ] = leftArea.split({ type: "vertical", sizes: ["70%", null], resize: false });

        // Add Shader data
        {
            shaderDataArea.root.className += " pt-4 items-center justify-center bg-primary";
            const shaderDataContainer = LX.makeContainer( [`100%`, "100%"], "p-6 flex flex-col gap-2 rounded-lg bg-secondary", "", shaderDataArea );
            const shaderName = LX.makeContainer( [`auto`, "auto"], "fg-primary text-xxl font-semibold", this.shader.name, shaderDataContainer );
            const shaderAuthor = LX.makeContainer( [`auto`, "auto"], "fg-primary text-md", `by ${ this.shader.author }`, shaderDataContainer );
            // const shaderDate = LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg", this.shader.lastUpdatedDate, shaderDataContainer );
            const shaderDesc = LX.makeContainer( [`auto`, "auto"], "fg-primary mt-4 text-lg", this.shader.description, shaderDataContainer );
        }

        var [ canvasArea, canvasControlsArea ] = graphicsArea.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });

        // Add shader controls data
        {
            canvasControlsArea.root.className += " px-2 rounded-b-lg bg-secondary";
            const panel = canvasControlsArea.addPanel();
            panel.sameLine();
            panel.addButton( null, "ResetTime", () => { this.elapsedTime = 0 }, { icon: "SkipBack", title: "Reset time", tooltip: true } );
            panel.addButton( null, "PauseTime", () => { this.timePaused = !this.timePaused }, { icon: "Pause", title: "Pause/Resume", tooltip: true, swap: "Play" } );
            panel.addLabel( "0.0", { signal: "@elapsed-time", xclassName: "ml-auto", xinputClass: "text-end" } );
            panel.endLine( "items-center h-full" );
        }

        const canvas = document.createElement("canvas");
        canvas.className = "w-full h-full rounded-t-lg";
        canvasArea.attach( canvas );

        canvas.addEventListener("dragover", (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy"; // shows a copy cursor
        });

        canvas.addEventListener("drop", async (e) => {
            e.preventDefault();

            const file = e.dataTransfer.files[0];
            if (!file) return;
            if (file.type.startsWith("image/")) {
                await this.createTexture( file, 0 );
                await this.createRenderBindGroup();
            } else {
                console.warn("Dropped file is not an image:", file.type);
            }
        });
    },

    createNewShader() {

        const uid = "b79a-fa8f-012c";//LX.guidGenerator();
        // const shaderFilename = `shaders/unnamed-${ uid }.wgsl`;
        const shaderFilename = `shaders/image.wgsl`;

        this.shaderList.push( {
            "name": "Unnamed Shader",
            "uid": uid,
            "author": "Pedro Gonzalez", // Get this from the Login info
            "files": [ shaderFilename ]
        } );

        // Store to DB so we can get the info on reloading the page
        // ...

        window.location.href = `${ window.location.origin + window.location.pathname }?view=${ uid }`;

        console.log("wwefwefew");

        // Store to DB
        // ...

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

            this.resolutionBuffer = this.device.createBuffer({
                size: 8,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });
        }

        // Load any necessary texture channels for the current shader
        for( let i = 0; i < this.shader.channels?.length ?? 0; ++i )
        {
            await this.createTexture( this.shader.channels[ i ], i );
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

            const now = LX.getTime();
            const dt = now - this.lastTime;

            if( !this.timePaused )
            {
                this.elapsedTime += ( dt / 1000 );

                this.device.queue.writeBuffer(
                    this.timeBuffer,
                    0,
                    new Float32Array([ this.elapsedTime ])
                );

                LX.emit( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
            }

            this.device.queue.writeBuffer(
                this.resolutionBuffer,
                0,
                new Float32Array([ this.gpuCanvas.offsetWidth, this.gpuCanvas.offsetHeight ])
            );

            this.lastTime = now;

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
            const bindings = this.uniformChannels.map( ( u, index ) => {
                if( !u ) return;
                return `@group(0) @binding(${ 3 + index }) var iChannel${ index } : texture_2d<f32>;`;
            } );
            templateCodeLines.splice( textureBindingsIndex, 1, ...(bindings.length ? [ `@group(0) @binding(1) var texSampler : sampler;`, ...bindings.filter( u => u !== undefined ) ] : []) );
        }

        // Process texture dummies so using it isn't mandatory
        {
            const textureDummiesIndex = templateCodeLines.indexOf( "$texture_dummies" );
            console.assert( textureDummiesIndex > -1 );
            templateCodeLines.splice( textureDummiesIndex, 1, ...[
                ...this.uniformChannels.map( ( u, index ) => {
                    if( !u ) return;
                    return `    let channel${ index }Dummy: vec4f = textureSample(iChannel${ index }, texSampler, fragUV);`;
                } ).filter( u => u !== undefined )
            ] );
        }

        // Add main image
        {
            const mainImageIndex = templateCodeLines.indexOf( "$main_image" );
            console.assert( mainImageIndex > -1 );
            const currentTab = `shaders/${ this.editor.getSelectedTabName() }`;
            const mainImageLines = this.loadedFiles[ currentTab ].replaceAll( '\r', '' ).split( "\n" );
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
            },
            {
                binding: 1,
                resource: {
                    buffer: this.resolutionBuffer,
                }
            }
        ]

        const bindings = this.uniformChannels.filter( u => u !== undefined );

        if( bindings.length )
        {
            entries.push( { binding: 2, resource: this.sampler } );
            entries.push( ...this.uniformChannels.map( ( u, index ) => {
                if( !u ) return;
                return { binding: 3 + index, resource: u.createView() }
            } ).filter( u => u !== undefined ) );
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
            const currentTab = `shaders/${ this.editor.getSelectedTabName() }`;
            const mainImageLines = this.loadedFiles[ currentTab ].replaceAll( '\r', '' ).split( "\n" );
            const mainImageLineOffset = codeLines.indexOf( mainImageLines[ 0 ] );
            console.assert( mainImageLineOffset > 0 );

            for( const msg of info.messages )
            {
                const fragLineNumber = msg.lineNum - ( mainImageLineOffset );

                if( showFeedback )
                {
                    LX.toast( `❌ ${ LX.toTitleCase( msg.type ) }: ${ fragLineNumber }:${ msg.linePos }`, msg.message, { timeout: -1, position: "top-right" } );
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
            LX.toast( `✅ No errors`, "Shader compiled successfully!", { position: "top-right" } );
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

    async snapshotCanvas( outWidth, outHeight ) {

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

    async getCanvasSnapshot() {

        const blob = await this.snapshotCanvas();
        const url = URL.createObjectURL( blob );
        window.open(url);
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
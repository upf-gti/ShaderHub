import { LX } from 'lexgui';
import * as Constants from "./constants.js";

class Renderer
{
    constructor( canvas )
    {
        this.canvas = canvas;

        this.gpuTextures    = {};
        this.gpuBuffers     = {};
    }

    async init()
    {
        this.adapter = await navigator.gpu?.requestAdapter({
            featureLevel: 'compatibility',
        });

        this.device = await this.adapter?.requestDevice();
        if( this.quitIfWebGPUNotAvailable() === Constants.WEBGPU_ERROR )
        {
            return;
        }

        this.webGPUContext = this.canvas.getContext( 'webgpu' );

        const devicePixelRatio = window.devicePixelRatio;
        this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
        this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

        this.presentationFormat = navigator.gpu.getPreferredCanvasFormat();

        this.webGPUContext.configure({
            device: this.device,
            format: this.presentationFormat,
        });

        // Input Parameters
        {
            this.gpuBuffers[ "iTime" ] = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "iTimeDelta" ] = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "iFrame" ] = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "iResolution" ] = this.device.createBuffer({
                size: 8,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.gpuBuffers[ "iMouse" ] = this.device.createBuffer({
                size: 32,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });
        }

        // clamp-to-edge samplers
        Renderer.nearestSampler = this.device.createSampler();
        Renderer.bilinearSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
        Renderer.trilinearSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' });

        // repeat samplers
        Renderer.nearestRepeatSampler = this.device.createSampler({ addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
        Renderer.bilinearRepeatSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
        Renderer.trilinearRepeatSampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: "repeat", addressModeV: "repeat", addressModeW: "repeat" });
    }

    updateFrame( timeDelta, elapsedTime, frameCount )
    {
        if( !this.device )
        {
            return;
        }

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "iTimeDelta" ],
            0,
            new Float32Array([ timeDelta ])
        );

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "iTime" ],
            0,
            new Float32Array([ elapsedTime ])
        );

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "iFrame" ],
            0,
            new Int32Array([ frameCount ])
        );
    }

    updateResolution( resolutionX, resolutionY )
    {
        if( !this.device )
        {
            return;
        }

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "iResolution" ],
            0,
            new Float32Array([
                resolutionX ?? this.canvas.offsetWidth,
                resolutionY ?? this.canvas.offsetHeight
            ])
        );
    }

    updateMouse( data )
    {
        if( !this.device )
        {
            return;
        }

        this.device.queue.writeBuffer(
            this.gpuBuffers[ "iMouse" ],
            0,
            new Float32Array( data )
        );
    }

    async createTexture( data, id, label = "" )
    {
        const options = { flipY: false };
        const imageBitmap = await createImageBitmap( await new Blob( [ data ] ) );
        const dimensions = [ imageBitmap.width, imageBitmap.height ];
        const texture = this.device.createTexture({
            label,
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
            format: 'rgba8unorm',
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap, ...options },
            { texture: texture },
            dimensions
        );

        this.gpuTextures[ id ] = texture;

        return texture;
    }

    async createCubemapTexture( arrayBuffer, id, label = "" )
    {
        const zip = await JSZip.loadAsync( arrayBuffer );
        const faceNames = [ "px", "nx", "py", "ny", "pz", "nz" ];
        const faceImages = [];

        for( const face of faceNames )
        {
            const file = zip.file( `${ face }.png` ) || zip.file( `${ face }.jpg` );
            if( !file ) throw new Error( `Missing cubemap face: ${ face }` );
            const blob = await file.async( "blob" );
            const imageBitmap = await createImageBitmap( blob );
            faceImages.push( imageBitmap );
        }

        const { width, height } = faceImages[ 0 ];

        const texture = this.device.createTexture({
            label,
            size: [ width, height, 6 ],
            format: "rgba8unorm",
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
            dimension: "2d",
        });

        for( let i = 0; i < 6; i++ )
        {
            this.device.queue.copyExternalImageToTexture(
                { source: faceImages[ i ] },
                { texture, origin: [ 0, 0, i ] },
                [ width, height ]
            );
        }

        this.gpuTextures[ id ] = texture;

        return texture;
    }

    quitIfWebGPUNotAvailable()
    {
        if( !this.device )
        {
            return this.quitIfAdapterNotAvailable();
        }

        this.device.lost.then( reason => {
            this.fail(`Device lost ("${ reason.reason }"):\n${ reason.message }`);
        });

        // device.addEventListener('uncapturederror', (ev) => {
        //     this.fail(`Uncaptured error:\n${ev.error.message}`);
        // });

        return Constants.WEBGPU_OK;
    }

    quitIfAdapterNotAvailable()
    {
        if( !( "gpu" in navigator ) )
        {
            this.fail( "'navigator.gpu' is not defined - WebGPU not available in this browser" );
        }
        else if( !this.adapter )
        {
            this.fail( "No adapter found after calling 'requestAdapter'." );
        }
        else
        {
            this.fail( "Unable to get WebGPU device for an unknown reason." );
        }

        return Constants.WEBGPU_ERROR;
    }

    fail( msg, msgTitle )
    {
        new LX.Dialog( msgTitle ?? "❌ WebGPU Error", p => {
            p.root.classList.add( "p-4" );
            p.root.innerHTML = msg;
        }, { modal: true } );
    }
}

// Each shader pass corresponds to a shader file
class ShaderPass
{
    constructor( shader, device, data )
    {
        this.shader = shader;
        this.name   = data.name;
        this.device = device;
        this.type   = data.type ?? "image";

        // Make sure we copy everything to avoid references
        this.resolution = [ data.resolutionX ?? 0, data.resolutionY ?? 0 ];
        this.codeLines  = [ ...( data.codeLines ?? this.shader.getDefaultCode( this ) ) ];
        this.channels   = [ ...( data.channels ?? [] ) ];
        this.uniforms   = [ ...( data.uniforms ?? [] ) ];
        this.channelTextures    = [];
        this.uniformBuffers     = [];
        this.defines            = {};

        this.pipeline   = null;
        this.bindGroup  = null;

        this.uniformsDirty  = false;

        this.frameCount = 0;

        if( this.type === "buffer" )
        {
            this.textures = [
                device.createTexture({
                    label: "Buffer Pass Texture A",
                    size: [ this.resolution[ 0 ], this.resolution[ 1 ], 1 ],
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                }),
                device.createTexture({
                    label: "Buffer Pass Texture B",
                    size: [ this.resolution[ 0 ], this.resolution[ 1 ], 1 ],
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                })
            ];
        }
        else if( this.type === "compute" )
        {
            this.computePipelines   = [ ];
            this.storageBuffers     = { };

            this.textures = [
                device.createTexture({
                    label: "Compute Pass Texture A",
                    size: [ this.resolution[ 0 ], this.resolution[ 1 ], 1 ],
                    format: "rgba16float",
                    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
                }),
                    device.createTexture({
                    label: "Compute Pass Texture B",
                    size: [ this.resolution[ 0 ], this.resolution[ 1 ], 1 ],
                    format: "rgba16float",
                    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
                })
            ];
        }
    }

    async execute( renderer )
    {
        if( this.type === "common" )
        {
            return;
        }

        if( this.mustCompile || ( !this.pipeline && !( this.computePipelines ?? [] ).length ) || !this.bindGroup )
        {
            const r = await this.compile( renderer );
            if( r !== Constants.WEBGPU_OK )
            {
                return;
            }
        }

        if( this.type === "image" )
        {
            const commandEncoder = this.device.createCommandEncoder();
            const textureView = renderer.webGPUContext.getCurrentTexture().createView();

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
            passEncoder.setPipeline( this.pipeline );

            if( this.bindGroup )
            {
                passEncoder.setBindGroup( 0, this.bindGroup );
            }

            passEncoder.draw( 6 );
            passEncoder.end();

            this.device.queue.submit( [ commandEncoder.finish() ] );
        }
        else if( this.type === "buffer" )
        {
            if( !this.textures[ 0 ] || !this.textures[ 1 ] )
            {
                return;
            }

            const commandEncoder = this.device.createCommandEncoder();
            const renderTarget = this.textures[( this.frameCount + 1 ) % 2];
            const textureView = renderTarget.createView();

            const renderPassDescriptor = {
                colorAttachments: [
                    {
                        view: textureView,
                        clearValue: [0, 0, 0, 1],
                        loadOp: 'clear',
                        // loadOp: 'load',
                        storeOp: 'store'
                    },
                ],
            };

            const passEncoder = commandEncoder.beginRenderPass( renderPassDescriptor );
            passEncoder.setPipeline( this.pipeline );

            const bindGroup = ( this.frameCount % 2 === 0 ) ? this.bindGroup : this.bindGroupB;
            if( bindGroup )
            {
                passEncoder.setBindGroup( 0, bindGroup );
            }

            passEncoder.draw( 6 );
            passEncoder.end();

            this.device.queue.submit( [ commandEncoder.finish() ] );

            this.frameCount++;
        }
        else if( this.type === "compute" )
        {
            if( !this.textures[ 0 ] || !this.textures[ 1 ] )
            {
                return;
            }

            const commandEncoder = this.device.createCommandEncoder();

            for( const pipelineRes of this.computePipelines )
            {
                if( pipelineRes.executeOnce && pipelineRes.executionDone )
                {
                    continue;
                }

                // console.log(pipelineRes.pipeline.label)

                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline( pipelineRes.pipeline );

                const bindGroup = ( this.frameCount % 2 === 0 ) ? pipelineRes.bindGroup : pipelineRes.bindGroupB;
                if( bindGroup )
                {
                    computePass.setBindGroup( 0, bindGroup );
                }

                const storageBindGroup = ( this.frameCount % 2 === 0 ) ? pipelineRes.storageBindGroupB : pipelineRes.storageBindGroup;
                if( storageBindGroup )
                {
                    computePass.setBindGroup( 1, storageBindGroup );
                }

                const wgSizeX = pipelineRes.workGroupSize[ 0 ];
                const wgSizeY = pipelineRes.workGroupSize[ 1 ];
                const wgSizeZ = pipelineRes.workGroupSize[ 2 ] ?? 1;

                const dispatchX = pipelineRes.workGroupCount[ 0 ] ?? Math.ceil( this.resolution[ 0 ] / wgSizeX );
                const dispatchY = pipelineRes.workGroupCount[ 1 ] ?? Math.ceil( this.resolution[ 1 ] / wgSizeY );
                const dispatchZ = pipelineRes.workGroupCount[ 2 ] ?? wgSizeZ;

                computePass.dispatchWorkgroups( dispatchX, dispatchY, dispatchZ );

                computePass.end();

                pipelineRes.executionDone = true;
            }

            this.device.queue.submit([commandEncoder.finish()]);

            this.frameCount++;
        }
    }

    async createPipeline( format )
    {
        if( this.type === "common" ) return;

        if( this.type === "image" || this.type === "buffer" )
        {
            const result = await this.validate();
            if( !result.valid )
            {
                return result;
            }

            this.pipeline = await this.device.createRenderPipeline({
                label: `Render Pipeline: ${ this.name }`,
                layout: 'auto',
                vertex: {
                    module: result.module,
                },
                fragment: {
                    module: result.module,
                    targets: [
                        {
                            format
                        },
                    ],
                },
                primitive: {
                    topology: 'triangle-list',
                }
            });

            // Attach used bindings extracted from code
            this.pipeline.defaultBindings = result.defaultBindings;
            this.pipeline.customBindings = result.customBindings;
            this.pipeline.textureBindings = result.textureBindings;
            this.pipeline.samplerBindings = result.samplerBindings;
            this.codeContent = result.code;

            console.warn( "Info: Render Pipeline created!" );
        }
        else
        {
            const computeFuncs = this.extractComputeFunctions( this.codeLines );

            this.computePipelines = [];

            let utilsCode = this.codeLines.join( "\n" );
            let fullCode = "";

            // Delete each entry code to generate the utils code
            for( const [ entry, entryCode ] of Object.entries( computeFuncs ) )
            {
                utilsCode = utilsCode.replace( entryCode, "" );
            }

            utilsCode = utilsCode.trim();

            for( const [ entry, entryCode ] of Object.entries( computeFuncs ) )
            {
                // rename main entry
                const entryName = entry.replace( "mainCompute", "compute_main" );
                const entryUtils = `${ utilsCode }\n${ entryCode.includes( "mainCompute" ) ? "" : "fn mainCompute(id: vec3u) { }" }`;

                const result = await this.validate( entryName, `${ entryUtils }\n${ entryCode }` );
                if( !result.valid )
                {
                    return result;
                }

                const p = await this.device.createComputePipeline( {
                    label: `Compute Pipeline Entry: ${ entryName }`,
                    layout: 'auto',
                    compute: {
                        module: result.module,
                        entryPoint: entryName,
                    }
                } );

                // Attach used bindings extracted from code
                p.defaultBindings = result.defaultBindings;
                p.customBindings = result.customBindings;
                p.textureBindings = result.textureBindings;
                p.samplerBindings = result.samplerBindings;
                p.storageBindings = result.storageBindings;

                fullCode += result.code;

                this.computePipelines.push( {
                    pipeline: p,
                    usesComputeScreenTexture: result.usesComputeScreenTexture,
                    executeOnce: result.executeOnce[ entryName ] ?? false,
                    workGroupSize: result.wgSizes[ entryName ] ?? [ 16, 16, 1 ],
                    workGroupCount: result.wgCounts[ entryName ] ?? []
                } );
            }

            this.codeContent = fullCode;

            console.warn( "Info: Compute Pipeline created!" );

            return this.computePipelines[ 0 ].pipeline;
        }

        return this.pipeline;
    }

    async createBindGroup( p, buffers )
    {
        const pipeline = p.pipeline ?? p;
        if( !pipeline )
        {
            return;
        }

        let bindingIndex = 0;

        const entries = [];

        console.assert( pipeline.defaultBindings, "Pipeline does not have a default bindings list!" );
        console.assert( pipeline.customBindings, "Pipeline does not have a custom bindings list!" );
        console.assert( pipeline.textureBindings, "Pipeline does not have a texture bindings list!" );
        console.assert( pipeline.samplerBindings, "Pipeline does not have a sampler bindings list!" );

        Object.entries( pipeline.defaultBindings ).forEach( b => {
            const [ name, index ] = b;
            const binding = bindingIndex++;
            console.assert( binding === index, `Default binding indices do not match in pipeline: ${ pipeline.label }` );
            entries.push( { binding, resource: { buffer: buffers[ name ] } } );
        } );

        const customUniformCount = this.uniforms.length;
        if( customUniformCount )
        {
            this.uniforms.forEach( ( u, index ) => {
                if( pipeline.customBindings[ u.name ] === undefined ) return;
                const binding = bindingIndex++;
                console.assert( binding === pipeline.customBindings[ u.name ], `Custom binding indices do not match in pipeline: ${ pipeline.label }` );
                const buffer = this.uniformBuffers[ index ];
                this.device.queue.writeBuffer(
                    buffer,
                    0,
                    new Float32Array([ u.value ])
                );
                entries.push( {
                    binding,
                    resource: { buffer }
                } );
            } );
        }

        const hasTextureBindings = Object.keys( pipeline.textureBindings ).length > 0;

        // Store base entries to create 2nd bind group for buffer passes
        let baseBindingIndex = bindingIndex;
        let baseEntries = [ ...entries ];

        if( hasTextureBindings )
        {
            entries.push( ...this.channels.map( ( channelName, index ) => {
                if( !channelName ) return;
                if( !pipeline.textureBindings[ channelName ] ) return;
                let texture = this.channelTextures[ index ];
                if( !texture ) return;
                const binding = bindingIndex++;
                console.assert( binding === pipeline.textureBindings[ channelName ], `Texture binding indices do not match in pipeline: ${ pipeline.label }` );
                texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_TEXTURE_A_INDEX ] : texture;
                const resource = texture.depthOrArrayLayers > 1 ? texture.createView( { dimension: 'cube' } ) : texture.createView();
                return { binding, resource };
            } ).filter( u => u !== undefined ) );

            // Add sampler bindings
            Object.entries( pipeline.samplerBindings ).forEach( b => {
                const [ samplerName, index ] = b;
                const binding = bindingIndex++;
                console.assert( binding === index, `Sampler binding indices do not match in pipeline: ${ pipeline.label }` );
                entries.push( { binding, resource: Renderer[ samplerName ] } );
            } );
        }

        if( this.type === "compute" && p.usesComputeScreenTexture )
        {
            entries.push( { binding: bindingIndex++, resource: this.textures[ Constants.BUFFER_PASS_TEXTURE_A_INDEX ].createView() } );
        }

        this.bindGroup = await this.device.createBindGroup({
            label: "Bind Group A",
            layout: pipeline.getBindGroupLayout( 0 ),
            entries
        });

        // Create 2nd bind group for buffer passes to swap textures
        if( this.type === "buffer" || this.type === "compute" )
        {
            if( hasTextureBindings )
            {
                baseEntries.push( ...this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    if( !pipeline.textureBindings[ channelName ] ) return;
                    let texture = this.channelTextures[ index ];
                    if( !texture ) return;
                    const binding = baseBindingIndex++;
                    console.assert( binding === pipeline.textureBindings[ channelName ], `Texture binding indices do not match in pipeline: ${ pipeline.label }` );
                    texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_TEXTURE_B_INDEX ] : texture;
                    const resource = texture.depthOrArrayLayers > 1 ? texture.createView( { dimension: 'cube' } ) : texture.createView();
                    return { binding, resource };
                } ).filter( u => u !== undefined ) );

                // Add sampler bindings
                Object.entries( pipeline.samplerBindings ).forEach( b => {
                    const [ samplerName, index ] = b;
                    const binding = baseBindingIndex++;
                    console.assert( binding === index, `Sampler binding indices do not match in pipeline: ${ pipeline.label }` );
                    baseEntries.push( { binding, resource: Renderer[ samplerName ] } );
                } );
            }

            if( this.type === "compute" && p.usesComputeScreenTexture )
            {
                baseEntries.push( { binding: baseBindingIndex++, resource: this.textures[ Constants.BUFFER_PASS_TEXTURE_B_INDEX ].createView() } );
            }

            this.bindGroupB = await this.device.createBindGroup({
                label: "Bind Group B",
                layout: pipeline.getBindGroupLayout( 0 ),
                entries: baseEntries
            });
        }

        console.warn( "Info: Bind Group created!" );

        return this.bindGroup;
    }

    async createStorageBindGroup( pipeline, useSecondary )
    {
        if( !pipeline )
        {
            return;
        }

        const entries = [];

        for( const [ bufferName, bufferIndex ] of Object.entries( pipeline.storageBindings ) )
        {
            const gpuBuffer = this.storageBuffers[ bufferName ];
            console.assert( gpuBuffer, `Storage buffer '${ bufferName }' not created!` );
            const resourceBuffer = useSecondary ? gpuBuffer.resourceB : gpuBuffer.resource;
            entries.push( {
                binding: bufferIndex,
                resource: { buffer: resourceBuffer }
            } );
        }

        const storageBindGroup = await this.device.createBindGroup({
            label: `Storage Bind Group ${ useSecondary ? "B" : "A" }`,
            layout: pipeline.getBindGroupLayout( 1 ),
            entries
        });

        this[ `storageBindGroup${ useSecondary ? 'B' : '' }` ] = storageBindGroup;

        console.warn( "Info: Storage Bind Group created!" );

        return storageBindGroup;
    }

    async compile( renderer )
    {
        const format = renderer.presentationFormat;
        const buffers = renderer.gpuBuffers;

        this.defines = {
            "SCREEN_WIDTH": this.resolution[ 0 ],
            "SCREEN_HEIGHT": this.resolution[ 1 ],
        };

        // Clean prev storage
        if( this.type === "compute" )
        {
            this.storageBuffers = {};
        }

        const pipeline = await this.createPipeline( format );
        if( pipeline?.constructor !== GPURenderPipeline
            && pipeline?.constructor !== GPUComputePipeline )
        {
            return pipeline;
        }

        const pipelines = [ this.pipeline, ...this.computePipelines ?? [] ];
        for( const p of pipelines )
        {
            if( !p ) continue;
            const bindGroup = await this.createBindGroup( p, buffers );
            p.bindGroup = this.bindGroup;
            p.bindGroupB = this.bindGroupB;
            if( bindGroup?.constructor !== GPUBindGroup )
            {
                return Constants.WEBGPU_ERROR;
            }
        }

        if( this.type === "compute" )
        {
            const pipelines = this.computePipelines ?? [];
            for( const p of pipelines )
            {
                const storageBindGroup = await this.createStorageBindGroup( p.pipeline );
                p.storageBindGroup = storageBindGroup;
                if( storageBindGroup?.constructor !== GPUBindGroup )
                {
                    return Constants.WEBGPU_ERROR;
                }

                const storageBindGroupB = await this.createStorageBindGroup( p.pipeline, true );
                p.storageBindGroupB = storageBindGroupB;
                if( storageBindGroupB?.constructor !== GPUBindGroup )
                {
                    return Constants.WEBGPU_ERROR;
                }
            }
        }

        this.frameCount     = 0;
        this.mustCompile    = false;

        return Constants.WEBGPU_OK;
    }

    async validate( entryName, entryCode )
    {
        const r = this.getShaderCode( true, entryName, entryCode );

        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

        const module = this.device.createShaderModule({ code: r.code });
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
                console.log( entryCode ?? "" );
                return { valid: false, code: r.code, messages: errorMsgs };
            }
        }

        return { valid: true, module, ...r };
    }

    resetExecution()
    {
        ( this.computePipelines ?? [] ).forEach( p => p.executionDone = false );

        this.frameCount = 0;
    }

    extractComputeFunctions( lines )
    {
        let results = {};
        let currentFunctionCode = null;

        for( const line of lines )
        {
            if( line.startsWith( "@compute" ) || line.startsWith( "fn mainCompute" ) )
            {
                if( currentFunctionCode )
                {
                    const code = currentFunctionCode.join( "\n" );
                    const regex = /(@compute[\s\S]*?fn\s+([A-Za-z_]\w*)\s*\(|fn\s+(mainCompute)\s*\()/g;

                    let match;

                    while ( ( match = regex.exec( code ) ) !== null )
                    {
                        results[ match[ 2 ] || match[ 3 ] ] = code;
                    }
                }

                currentFunctionCode = [ line ];
            }
            else if( currentFunctionCode )
            {
                if( line.startsWith( "#" ) ) // Make pre-processor utility code
                {
                    const code = currentFunctionCode.join( "\n" );
                    const regex = /(@compute[\s\S]*?fn\s+([A-Za-z_]\w*)\s*\(|fn\s+(mainCompute)\s*\()/g;

                    let match;

                    while ( ( match = regex.exec( code ) ) !== null )
                    {
                        results[ match[ 2 ] || match[ 3 ] ] = code;
                    }

                    continue;
                }

                currentFunctionCode.push( line );
            }
        }

        if( currentFunctionCode )
        {
            const code = currentFunctionCode.join( "\n" );
            const regex = /(@compute[\s\S]*?fn\s+([A-Za-z_]\w*)\s*\(|fn\s+(mainCompute)\s*\()/g;

            let match;

            while ( ( match = regex.exec( code ) ) !== null )
            {
                results[ match[ 2 ] || match[ 3 ] ] = code;
            }
        }

        return results;
    }

    /*
        This will detect bindings used in the code, discarding only the ones that are inside
        single line comments.
        TODO: Discard bindings used in BLOCK comments
    */
    isBindingUsed( binding, entryCode )
    {
        const templateCodeLines = [ ...( this.type === "compute" ) ? Shader.COMPUTER_SHADER_TEMPLATE : Shader.RENDER_SHADER_TEMPLATE ];
        const lines = [ ...templateCodeLines, ...entryCode.split( "\n" ) ].map( line => {
            const lineCommentIndex = line.indexOf( "//" );
            return line.substring( 0, lineCommentIndex === -1 ? undefined : lineCommentIndex );
        } );
        const regex = new RegExp( `\\b${ binding }\\b` );
        return lines.some( l => regex.test( l ) );
    }

    getShaderCode( includeBindings = true, entryName, entryCode )
    {
        const templateCodeLines = [ ...( this.type === "compute" ) ? Shader.COMPUTER_SHADER_TEMPLATE : Shader.RENDER_SHADER_TEMPLATE ];
        const shaderLines       = [ ...( entryCode ? entryCode.split( "\n" ) : this.codeLines ) ];
        const defaultBindings   = {};
        const customBindings    = {};
        const textureBindings   = {};
        const samplerBindings   = {};
        const storageBindings   = {};

        // Add shader utils depending on bind group
        {
            const features = this.shader.getFeatures();
            const hasTextureBindings = Object.keys( textureBindings ).length > 0;
            const wgslUtilsIndex = templateCodeLines.indexOf( "$wgsl_utils" );
            if( wgslUtilsIndex > -1 )
            {
                const utils = [
                    ...( hasTextureBindings ? Shader.WGSL_TEXTURE_UTILS : [] ),
                    ...( features.includes( "keyboard" ) ? Shader.WGSL_KEYBOARD_UTILS : [] ),
                ]
                templateCodeLines.splice( wgslUtilsIndex, 1, ...utils );
            }
        }

        // Add common block
        {
            const commonPass = this.shader.passes.find( p => p.type === "common" );
            const allCommon = commonPass?.codeLines ?? [];
            const commonIndex = templateCodeLines.indexOf( "$common" );
            console.assert( commonIndex > -1 );
            templateCodeLines.splice( commonIndex, 1, ...allCommon );
        }

        // Add main lines
        {
            const mainImageIndex = templateCodeLines.indexOf( "$main_entry" );
            console.assert( mainImageIndex > -1 );
            templateCodeLines.splice( mainImageIndex, 1, ...shaderLines );
        }

        // Parse general preprocessor lines
        // This has to be the last step before the bindings, to replace every define appearance!
        {
            this._pLine = 0;

            while( this._pLine < templateCodeLines.length )
            {
                this._parseShaderLine( templateCodeLines );
            }

            delete this._pLine;

            if( this.type === "compute" )
            {
                this.structs            = this._parseStructs( templateCodeLines.join( "\n" ) );
                this.workGroupSizes     = {};
                this.workGroupCounts    = {};
                this.executeOnce        = {};

                for( let i = 0; i < templateCodeLines.length; ++i )
                {
                    templateCodeLines[ i ] = this._parseComputeLine( templateCodeLines[ i ], entryName, entryCode, storageBindings );
                }

                const computeEntryIndex = templateCodeLines.indexOf( "$compute_entry" );
                console.assert( computeEntryIndex > -1 );
                templateCodeLines.splice( computeEntryIndex, 1, `@compute @workgroup_size(${ this.workGroupSizes[ entryName ] ?? [ 16, 16, 1 ] })` );
            }
        }

        const noBindingsShaderCode = templateCodeLines.join( "\n" );

        if( includeBindings )
        {
            let bindingIndex = 0;

            // Default Uniform bindings
            {
                const defaultBindingsIndex = templateCodeLines.indexOf( "$default_bindings" );
                console.assert( defaultBindingsIndex > -1 );
                templateCodeLines.splice( defaultBindingsIndex, 1, ...Constants.DEFAULT_UNIFORMS_LIST.map( ( u, index ) => {
                    if( u.skipBindings ?? false ) return;
                    if( !this.isBindingUsed( u.name, noBindingsShaderCode ) ) return;
                    const binding = bindingIndex++;
                    defaultBindings[ u.name ] = binding;
                    return `@group(0) @binding(${ binding }) var<uniform> ${ u.name } : ${ u.type ?? "f32" };`;
                } ).filter( u => u !== undefined ) );
            }

            // Custom Uniform bindings
            {
                if( this.uniforms.length !== this.uniformBuffers.length )
                {
                    this.uniformBuffers.length = this.uniforms.length; // Set new length

                    for( let i = 0; i < this.uniformBuffers.length; ++i )
                    {
                        const u = this.uniforms[ i ];
                        const buffer = this.uniformBuffers[ i ];
                        if( !buffer )
                        {
                            this.uniformBuffers[ i ] = this.device.createBuffer({
                                size: Shader.GetUniformSize( u.type ?? "f32" ),
                                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
                            });
                        }
                    }
                }

                const customBindingsIndex = templateCodeLines.indexOf( "$custom_bindings" );
                console.assert( customBindingsIndex > -1 );
                templateCodeLines.splice( customBindingsIndex, 1, ...this.uniforms.map( ( u, index ) => {
                    if( !u ) return;
                    if( !this.isBindingUsed( u.name, noBindingsShaderCode ) ) return;
                    const binding = bindingIndex++;
                    customBindings[ u.name ] = binding;
                    return `@group(0) @binding(${ binding }) var<uniform> ${ u.name } : ${ u.type };`;
                } ).filter( u => u !== undefined ) );
            }

            // Process texture bindings
            {
                const textureBindingsIndex = templateCodeLines.indexOf( "$texture_bindings" );
                console.assert( textureBindingsIndex > -1 );
                const bindings = this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    const channelIndexName = `iChannel${ index }`;
                    if( !this.isBindingUsed( channelIndexName, noBindingsShaderCode ) ) return;
                    const binding = bindingIndex++;
                    textureBindings[ channelName ] = binding;
                    const texture = this.channelTextures[ index ];
                    return `@group(0) @binding(${ binding }) var ${ channelIndexName } : ${ texture.depthOrArrayLayers > 1 ? "texture_cube" : "texture_2d" }<f32>;`;
                } ).filter( u => u !== undefined );

                templateCodeLines.splice( textureBindingsIndex, 1, ...(bindings.length ? [
                    ...bindings,
                    ...( [ "nearestSampler", "bilinearSampler", "trilinearSampler",
                        "nearestRepeatSampler", "bilinearRepeatSampler", "trilinearRepeatSampler"
                    ].map( samplerName => {
                        if( !this.isBindingUsed( samplerName, noBindingsShaderCode ) ) return;
                        const binding = bindingIndex++;
                        samplerBindings[ samplerName ] = binding;
                        return `@group(0) @binding(${ binding }) var ${ samplerName } : sampler;`;
                    } ).filter( u => u !== undefined ) )
                ] : []) );
            }

            if( this.type === "compute" )
            {
                const outputBindingIndex = templateCodeLines.indexOf( "$output_binding" );
                console.assert( outputBindingIndex > -1 );
                this.usesComputeScreenTexture = this.isBindingUsed( "screen", noBindingsShaderCode );
                templateCodeLines.splice( outputBindingIndex, 1, this.usesComputeScreenTexture ? `@group(0) @binding(${ bindingIndex++ }) var screen: texture_storage_2d<rgba16float,write>;` : undefined );
            }
        }

        const shaderResult = {
            code: templateCodeLines.join( "\n" ),
            defaultBindings,
            customBindings,
            textureBindings,
            samplerBindings,
            storageBindings,
            executeOnce: this.executeOnce,
            wgSizes: this.workGroupSizes,
            wgCounts: this.workGroupCounts,
            usesComputeScreenTexture: this.usesComputeScreenTexture
        };

        // delete tmp context
        delete this.structs;
        delete this.executeOnce;
        delete this.workGroupSizes;
        delete this.workGroupCounts;
        delete this.usesComputeScreenTexture;

        return shaderResult;
    }

    _computeStructSize( members )
    {
        let offset      = 0;
        let maxAlign    = 1;

        for( const m of members )
        {
            const align = Shader.GetUniformAlign( m.type );
            const size = Shader.GetUniformSize( m.type );

            // align offset
            offset = Math.ceil(offset / align) * align;
            m.offset = offset;

            offset += size;
            maxAlign = Math.max( maxAlign, align );
        }

        // round struct size up to alignment
        const size = Math.ceil( offset / maxAlign ) * maxAlign;

        // array stride = round up to 16 bytes
        const stride = Math.ceil( size / 16 ) * 16;

        return { size, stride };
    }

    _parseStructs( code )
    {
        const structs = {};
        const structRegex = /struct\s+(\w+)\s*{([^}]*)}/g;
        let match;

        while( ( match = structRegex.exec( code ) ) !== null )
        {
            const name = match[ 1 ];
            const body = match[ 2 ].trim();

            // parse members
            const members = [];
            const memberRegex = /(\w+)\s*:\s*([\w<>\s]+)(,|\\n)/g;
            let m;
            while( ( m = memberRegex.exec( body ) ) !== null )
            {
                members.push({ name: m[ 1 ], type: m[ 2 ].trim() });
            }

            // compute struct size
            const { size, stride } = this._computeStructSize( members );
            structs[ name ] = { name, members, size, stride };
        }

        return structs;
    }

    _parseStorageType( str )
    {
        const arrayRE = /^array\s*<\s*(.+)\s*,\s*([A-Za-z0-9_]+)\s*>\s*$/i;

        const match = str.match( arrayRE );
        if( match )
        {
            const elemType = this._parseStorageType( match[ 1 ] );
            const countName = match[ 2 ];
            const count = isNaN( countName )
                ? this.defines[ countName ] ?? 0
                : parseInt( countName );
            return {
                kind: "array",
                elem: elemType,
                count,
            };
        }

        let type = str;
        let size = Shader.GetUniformSize( type );
        if( size === 0 )
        {
            size = this.structs[ type ]?.size ?? 0;
        }

        return { kind: "base", type, size };
    }

    _getBufferSize( node )
    {
        if( node.kind === "base" ) return node.size;
        if( node.kind === "array" )
        {
            const elemSize = this._getBufferSize( node.elem );
            return elemSize * ( node.count ?? 1 );
        }
        return 0;
    }

    _replaceDefines( line )
    {
        for( const [ name, value ] of Object.entries( this.defines ) )
        {
            line = line.replaceAll( name, value );
        }

        return line;
    }

    _parseIfDirective( line )
    {
        const m = line.match(/^\s*#\s*(?:ELSE)?IF\s+(.+?)\s*$/i);
        if( !m ) return null;

        const cond = m[ 1 ].trim();

        // helpers
        const isNumber = s => /^[-+]?\d+(\.\d+)?$/.test(s);
        const isBoolean = s => /^(true|false)$/i.test(s);
        const isIdentifier = s => /^[A-Za-z_]\w*$/.test(s);

        // single token cases
        if( isNumber( cond ) )
        {
            return { raw: cond, type: 'literal', kind: 'number', value: Number(cond) };
        }
        if( isBoolean( cond ) )
        {
            return { raw: cond, type: 'literal', kind: 'boolean', value: cond.toLowerCase() === 'true' };
        }
        if( isIdentifier( cond ) )
        {
            return { raw: cond, type: 'identifier', name: cond };
        }

        // comparison: left <op> right  (operators: == != <= >= < >)
        // allow identifiers or numbers on each side, with optional whitespace
        const compRE = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/;
        const cm = cond.match( compRE );
        if( cm )
        {
            const leftRaw = cm[ 1 ].trim();
            const op = cm[ 2 ];
            const rightRaw = cm[ 3 ].trim();

            // parse operands (number | boolean | identifier)
            function parseOperand( t )
            {
                if (isNumber(t)) return { raw: t, type: 'literal', kind: 'number', value: Number( t ) };
                if (isBoolean(t)) return { raw: t, type: 'literal', kind: 'boolean', value: t.toLowerCase() === 'true' };
                if (isIdentifier(t)) return { raw: t, type: 'identifier', name: t };
                return { raw: t, type: 'unknown' };
            }

            return { raw: cond, type: 'comparison', op, left: parseOperand( leftRaw ), right: parseOperand( rightRaw ) };
        }

        // unknown if directive..
        return { raw: cond, type: 'unknown' };
    }

    _evaluateParsedCondition( parsed )
    {
        if( !parsed )
        {
            return false;
        }

        if( parsed.type === 'literal' )
        {
            if( parsed.kind === 'number' ) return parsed.value !== 0;
            if( parsed.kind === 'boolean' ) return Boolean( parsed.value );
            return Boolean( parsed.value );
        }

        if( parsed.type === 'identifier' )
        {
            const v = this.defines[ parsed.name ];
            if( typeof v === 'boolean' ) return v;
            return Number( v ) !== 0;
        }

        if( parsed.type === 'comparison' )
        {
            const resolve = ( op ) =>
            {
                if( op.type === 'literal' ) return op.value;
                if( op.type === 'identifier' ) return this.defines[ op.name ]
                if( op.type === 'raw' )
                {
                    const n = Number( op.raw );
                    return Number.isFinite( n ) ? n : op.raw;
                }
                return undefined;
            }

            const L = resolve( parsed.left );
            const R = resolve( parsed.right );

            switch( parsed.op )
            {
                case '==': return L == R;
                case '!=': return L != R;
                case '<=': return Number( L ) <= Number( R );
                case '>=': return Number( L ) >= Number( R );
                case '<': return Number( L ) < Number( R );
                case '>': return Number( L ) > Number( R );
                default: throw new Error( `Unsupported operator ${ parsed.op }` );
            }
        }

        return false;
    }

    _parseShaderLine( lines )
    {
        const line = lines[ this._pLine ];
        const tokens = line.split( " " );

        const iContinueUntilTags = ( ...tags ) =>
        {
            while( this._pLine < lines.length )
            {
                const line = lines[ this._pLine ];
                let tagFound = tags.filter( t => line.startsWith( t ) )[ 0 ];
                if( tagFound )
                {
                    lines[ this._pLine++ ] = "";
                    return [ tagFound, line ];
                }

                this._pLine++;
            }
        };
        const iDeleteUntilTags = ( ...tags ) =>
        {
            while( this._pLine < lines.length )
            {
                const line = lines[ this._pLine ];
                let tagFound = tags.filter( t => line.startsWith( t ) )[ 0 ];
                if( tagFound )
                {
                    lines[ this._pLine++ ] = "";
                    return [ tagFound, line ];
                }

                lines[ this._pLine++ ] = "";
            }
        };
        const iStartIf = ( line ) =>
        {
            lines[ this._pLine++ ] = ""; // remove "if"/"elseif" lines

            const p = this._parseIfDirective( line );
            console.assert( p, `No If directive in line: ${ line }` );
            if( this._evaluateParsedCondition( p ) )
            {
                const [ tag, ln ] = iContinueUntilTags( "#elseif", "#else", "#endif" );
                if( tag == "#else" || tag == "#elseif" )
                {
                    iDeleteUntilTags( "#endif" );
                }
            }
            else
            {
                const [ tag, ln ] = iDeleteUntilTags( "#elseif", "#else", "#endif" );
                if( tag == "#else" )
                {
                    iContinueUntilTags( "#endif" );
                }
                else if( tag == "#elseif" )
                {
                    this._pLine--; // We have to evaluate prev line here
                    iStartIf( ln );
                }
            }
        };

        if( line.startsWith( "#include" ) )
        {
            // TODO
            lines[ this._pLine++ ] = "";
            return;
        }
        if( line.startsWith( "#define" ) )
        {
            const defineName = tokens[ 1 ];
            const defineValue = tokens.slice( 2 ).join( " " ); // All starting from the 2nd index
            this.defines[ defineName ] = defineValue;
            lines[ this._pLine++ ] = "";
            return;
        }
        if( line.startsWith( "#if" ) || line.startsWith( "#elseif" ) )
        {
            iStartIf( line );
            return;
        }

        // Replace defines
        lines[ this._pLine++ ] = this._replaceDefines( line );
    }

    _parseComputeStorageLine( line, entryName, entryCode, storageBindings )
    {
        const m = line.match( /^\s*#\s*storage\s+([A-Za-z_]\w*)\s+(.+)\s*$/i );
        if( !m ) return "";

        // Parse name and type and create storage buffer
        const bufferName = m[ 1 ];
        const typeExpr = m[ 2 ].trim();
        const bufferType = this._parseStorageType( typeExpr );

        const entryCodeExceptLine = entryCode.replace( line, "" );
        if( !this.isBindingUsed( bufferName, entryCodeExceptLine ) )
        {
            return "";
        }

        if( !this.storageBuffers[ bufferName ] )
        {
            const bufferSize = this._getBufferSize( bufferType );

            const storageBuffer = this.device.createBuffer({
                label: `${ bufferName} (storage)`,
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            const storageBufferB = this.device.createBuffer({
                label: `${ bufferName} (storage B)`,
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            this.storageBuffers[ bufferName ] = { name: bufferName, size: bufferSize, resource: storageBuffer, resourceB: storageBufferB };
        }

        const bufferIndex = Object.keys( storageBindings ).length;
        storageBindings[ bufferName ] = bufferIndex;

        return `@group(1) @binding(${ bufferIndex }) var<storage, read_write> ${ bufferName }: ${ typeExpr };`;
    }

    _parseComputeLine( line, entryName, entryCode, storageBindings )
    {
        const tokens = line.split( " " );

        if( line.includes( "@workgroup_size" ) )
        {
            const match = line.match( /@workgroup_size\s*\(\s*(\d+)(?:\s*,\s*(\d+))?(?:\s*,\s*(\d+))?\s*\)/ );
            if( match )
            {
                const [, x, y, z] = match;
                this.workGroupSizes[ entryName ] = [ parseInt( x ?? 16 ), parseInt( y ?? 16 ), parseInt( z ?? 1 ) ];
            }
        }
        else if( line.startsWith( "#workgroup_count" ) )
        {
            const entry = tokens[ 1 ];
            this.workGroupCounts[ entry ] = [ parseInt( tokens[ 2 ] ), parseInt( tokens[ 3 ] ?? "16" ), parseInt( tokens[ 4 ] ?? "1" ) ];
            return "";
        }
        else if( line.startsWith( "#dispatch_once" ) )
        {
            const entry = tokens[ 1 ];
            this.executeOnce[ entry ] = true;
            return "";
        }
        else if( line.startsWith( "#storage" ) )
        {
            return this._parseComputeStorageLine( line, entryName, entryCode, storageBindings );
        }

        return line;
    }

    setChannelTexture( channelIndex, texture )
    {
        this.channelTextures[ channelIndex ] = texture;
    }

    updateUniforms()
    {
        if( this.uniforms.length === 0 )
            return;

        this.uniforms.map( ( u, index ) => {
            let buffer = this.uniformBuffers[ index ];
            if( !buffer )
            {
                this.uniformBuffers[ index ] = this.device.createBuffer({
                    size: Shader.GetUniformSize( u.type ?? "f32" ),
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
                });
            }

            this.device.queue.writeBuffer(
                this.uniformBuffers[ index ],
                0,
                new Float32Array( [].concat( u.value ) )
            );
        } );

        this.uniformsDirty = false;
    }

    resizeBuffer( resolutionX, resolutionY )
    {
        const oldResolution = this.resolution;
        if( ( oldResolution[ 0 ] === resolutionX ) || ( oldResolution[ 1 ] === resolutionY ) )
            return;

        this.resolution = [ resolutionX, resolutionY ];

        if( this.type === "buffer" )
        {

            this.textures = [
                this.device.createTexture({
                    label: "Buffer Pass Texture A",
                    size: [ resolutionX, resolutionY, 1 ],
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                }),
                this.device.createTexture({
                    label: "Buffer Pass Texture B",
                    size: [ resolutionX, resolutionY, 1 ],
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                })
            ];
        }
        else if( this.type === "compute" )
        {
            this.textures = [
                this.device.createTexture({
                    label: "Compute Pass Texture A",
                    size: [ resolutionX, resolutionY, 1 ],
                    format: "rgba16float",
                    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
                }),
                this.device.createTexture({
                    label: "Compute Pass Texture B",
                    size: [ resolutionX, resolutionY, 1 ],
                    format: "rgba16float",
                    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
                })
            ];
        }
    }
}

class Shader {

    constructor( data )
    {
        this.name = data.name ?? "";
        this.uid = data.uid;
        this.url = data.url;
        this.passes = data.passes ?? [];
        this.type = "render";

        this.author = data.author ?? "anonymous";
        this.authorId = data.authorId;
        this.originalId = data.originalId;
        this.anonAuthor = data.anonAuthor ?? false;
        this.description = data.description ?? "";
        this.creationDate = data.creationDate ?? "";
        this.hasPreview = data.hasPreview ?? false;
        this.likes = data.likes ?? [];
    }

    static GetUniformSize = function( type ) {
        switch( type )
        {
            case "f32":
            case "i32":
            case "u32":
            return 4;
            case "vec2f":
            case "vec2i":
            case "vec2u":
            return 8;
            case "vec3f":
            case "vec3i":
            case "vec3u":
            return 12;
            case "vec4f":
            case "vec4i":
            case "vec4u":
            return 16;
            case "mat4x4f":
            return 64;
        }
        return 0;
    }

    static GetUniformAlign = function( type ) {
        switch( type )
        {
            case "f32":
            case "i32":
            case "u32":
            return 4;
            case "vec2f":
            case "vec2i":
            case "vec2u":
            return 8;
            case "vec3f":
            case "vec3i":
            case "vec3u":
            case "vec4f":
            case "vec4i":
            case "vec4u":
            return 16;
        }
        return 0;
    }

    getDefaultCode( pass )
    {
        return ( pass.type === "buffer" ? Shader.RENDER_BUFFER_TEMPLATE : ( pass.type === "compute" ? Shader.COMPUTE_MAIN_TEMPLATE : Shader.RENDER_COMMON_TEMPLATE ) )
    }

    getFeatures()
    {
        const features = [];

        const buffers = this.passes.filter( p => p.type === "buffer" );
        if( buffers.length ) features.push( "multipass" );

        const computes = this.passes.filter( p => p.type === "compute" );
        if( computes.length ) features.push( "compute" );

        this.passes.some( p => {
            const keyboardPasses = p.channels.filter( u => u === "Keyboard" );
            if( keyboardPasses.length )
            {
                features.push( "keyboard" );
                return true;
            }
        } )

        return features.join( "," );
    }
}

Shader.WGSL_TEXTURE_UTILS = ``.split( "\n" );

Shader.WGSL_KEYBOARD_UTILS = `fn keyDown( texture: texture_2d<f32>, code : i32 ) -> f32 { return textureLoad( texture, vec2i(code, 0), 0 ).x; }
fn keyPressed( texture: texture_2d<f32>, code : i32 ) -> f32 { return textureLoad( texture, vec2i(code, 1), 0 ).x; }
fn keyState( texture: texture_2d<f32>, code : i32 ) -> f32 { return textureLoad( texture, vec2i(code, 2), 0 ).x; }`.split( "\n" );

Shader.COMMON = `struct MouseData {
    pos : vec2f,
    start : vec2f,
    delta : vec2f,
    press : f32,
    click : f32,
}
`;

Shader.RENDER_SHADER_TEMPLATE = `${ Shader.COMMON }$default_bindings
$custom_bindings
$texture_bindings

struct VertexOutput {
    @builtin(position) Position : vec4f,
    @location(0) fragUV : vec2f,
    @location(1) fragCoord : vec2f,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {
    const pos = array(
        vec2(-1.0, -1.0),
        vec2( 1.0, -1.0),
        vec2(-1.0,  1.0),
        vec2(-1.0,  1.0),
        vec2( 1.0, -1.0),
        vec2( 1.0,  1.0),
    );
    var output : VertexOutput;
    output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
    output.fragUV = (output.Position.xy * 0.5) + vec2(0.5, 0.5);
    output.fragUV.y = 1.0 - output.fragUV.y;
    output.fragCoord = output.fragUV * iResolution;
    return output;
}

$wgsl_utils
$common
$main_entry

@fragment
fn frag_main(@location(0) fragUV : vec2f, @location(1) fragCoord : vec2f) -> @location(0) vec4f {
    return mainImage(fragUV, fragCoord);
}`.split( "\n" );

Shader.RENDER_MAIN_TEMPLATE = `fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {
    // Normalized pixel coordinates (from 0 to 1)
    let uv : vec2f = fragUV; // The same as: fragCoord/iResolution.xy;

    // Time varying pixel color
    let color : vec3f = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0,2,4));

    // Output to screen
    return vec4f(color, 1.0);
}`.split( "\n" );

Shader.RENDER_COMMON_TEMPLATE = `fn someFunc(a: f32, b: f32) -> f32 {
    return a + b;
}`.split( "\n" );

Shader.RENDER_BUFFER_TEMPLATE = `fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {
    // Output to screen
    return vec4f(0.0, 0.0, 1.0, 1.0);
}`.split( "\n" );

/*
    Compute Shaders
*/

Shader.COMPUTER_SHADER_TEMPLATE = `${ Shader.COMMON }// struct DispatchInfo {
//     id: u32
// }

$default_bindings
$custom_bindings
$texture_bindings
$output_binding

// fn passStore(pass_index: int, coord: int2, value: float4) {
//     textureStore(pass_out, coord, pass_index, value);
// }

// fn passLoad(pass_index: int, coord: int2, lod: int) -> float4 {
//     return textureLoad(pass_in, coord, pass_index, lod);
// }

$common
$main_entry

$compute_entry
fn compute_main(@builtin(global_invocation_id) id: vec3u) {
    mainCompute(id);
}`.split( "\n" );

Shader.COMPUTE_MAIN_TEMPLATE = `fn mainCompute(id: vec3u) {
    // Viewport resolution (in pixels)
    let screen_size = textureDimensions(screen);

    // Prevent overdraw for workgroups on the edge of the viewport
    if (id.x >= screen_size.x || id.y >= screen_size.y) { return; }

    // Pixel coordinates (centre of pixel, origin at bottom left)
    let fragCoord = vec2f(f32(id.x) + 0.5, f32(screen_size.y - id.y) - 0.5);

    // Normalised pixel coordinates (from 0 to 1)
    let uv = fragCoord / vec2f(screen_size);

    // Time varying pixel colour
    var col = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0.,2.,4.));

    // Output to screen (gamma colour space, will be auto-converted later)
    textureStore(screen, id.xy, vec4f(col, 1.0));
}`.split( "\n" );

class FPSCounter
{
    constructor()
    {
        this.frame = 0;
        this.to = 0;
        this.fps = 0;
    }

    reset()
    {
        this.frame = 0;
        this.to = 0;
        this.fps = 60.0;
    }

    get()
    {
        return Math.floor( this.fps );
    }

    count( time )
    {
        this.frame++;

        if( ( time - this.to ) > 500.0 )
        {
            this.fps = 1000.0 * this.frame / ( time - this.to );
            this.frame = 0;
            this.to = time;
            return true;
        }

        return false;
    }
}

export { Renderer, Shader, ShaderPass, FPSCounter };
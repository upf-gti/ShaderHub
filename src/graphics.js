import * as Constants from "./constants.js";

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

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

// Each shader pass corresponds to a shader file
class ShaderPass {

    constructor( shader, device, data )
    {
        this.shader = shader;
        this.name   = data.name;
        this.device = device;
        this.type   = data.type ?? "image";
        // Make sure we copy everything to avoid references
        this.codeLines  = [ ...( data.codeLines ?? this.shader.getDefaultCode( this ) ) ];
        this.channels   = [ ...( data.channels ?? [] ) ];
        this.uniforms   = [ ...( data.uniforms ?? [] ) ];
        this.channelTextures    = [];
        this.uniformBuffers     = [];

        this.pipeline   = null;
        this.bindGroup  = null;

        this.uniformsDirty  = false;

        this.frameCount = 0;

        if( this.type === "buffer" )
        {
            this.resolution = [ data.resolutionX ?? 0, data.resolutionY ?? 0 ];

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
            this.resolution         = [ data.resolutionX ?? 0, data.resolutionY ?? 0 ];
            this.workGroupSize      = [ 16, 16, 1 ];
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

    async execute( format, ctx, buffers )
    {
        if( this.type === "common" )
        {
            return;
        }

        if( this.mustCompile || ( !this.pipeline && !( this.computePipelines ?? [] ).length ) || !this.bindGroup )
        {
            const r = await this.compile( format, buffers );
            if( r !== WEBGPU_OK )
            {
                return;
            }
        }

        if( this.type === "image" )
        {
            const commandEncoder = this.device.createCommandEncoder();
            const textureView = ctx.getCurrentTexture().createView();

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

                const computePass = commandEncoder.beginComputePass();
                computePass.setPipeline( pipelineRes.pipeline );

                const bindGroup = ( this.frameCount % 2 === 0 ) ? pipelineRes.bindGroup : pipelineRes.bindGroupB;
                if( bindGroup )
                {
                    computePass.setBindGroup( 0, bindGroup );
                }

                const storageBindGroup = pipelineRes.storageBindGroup;
                if( storageBindGroup )
                {
                    computePass.setBindGroup( 1, storageBindGroup );
                }

                const wgSizeX = this.workGroupSize[ 0 ];
                const wgSizeY = this.workGroupSize[ 1 ];
                const wgSizeZ = this.workGroupSize[ 2 ] ?? 1;

                const dispatchX = Math.ceil( this.resolution[ 0 ]  / wgSizeX );
                const dispatchY = Math.ceil( this.resolution[ 1 ]  / wgSizeY );
                const dispatchZ = wgSizeZ;

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
            this.pipeline.bindings = result.bindings;

            console.warn( "Info: Render Pipeline created!" );
        }
        else
        {
            const computeFuncs = this.extractComputeFunctions( this.codeLines );

            this.computePipelines = [];

            let utilsCode = this.codeLines.join( "\n" );

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

                const result = await this.validate( `${ entryUtils }\n${ entryCode }` );
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
                p.bindings = result.bindings;

                this.computePipelines.push( { pipeline: p, executeOnce: ( entryName === result.executeOnce ) } );
            }

            console.warn( "Info: Compute Pipeline created!" );

            return this.computePipelines[ 0 ].pipeline;
        }

        return this.pipeline;
    }

    async createBindGroup( pipeline, buffers )
    {
        if( !pipeline )
        {
            return;
        }

        let bindingIndex = 0;

        const entries = [];

        console.assert( pipeline.bindings, "Pipeline does not have used bindings!" );

        Object.entries( pipeline.bindings ).forEach( b => {
            entries.push( { binding: bindingIndex++, resource: { buffer: buffers[ b[ 1 ] ] } } );
        } );

        const customUniformCount = this.uniforms.length;
        if( customUniformCount )
        {
            this.uniforms.map( ( u, index ) => {
                const buffer = this.uniformBuffers[ index ];
                this.device.queue.writeBuffer(
                    buffer,
                    0,
                    new Float32Array([ u.value ])
                );
                entries.push( {
                    binding: bindingIndex++,
                    resource: { buffer }
                } );
            } );
        }

        const bindings = this.channels.filter( ( u, i ) => u !== undefined && this.channelTextures[ i ] );

        // Store base entries to create 2nd bind group for buffer passes
        let baseBindingIndex = bindingIndex;
        let baseEntries = [ ...entries ];

        if( bindings.length )
        {
            entries.push( ...this.channels.map( ( channelName, index ) => {
                if( !channelName ) return;
                let texture = this.channelTextures[ index ];
                if( !texture ) return;
                texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_TEXTURE_A_INDEX ] : texture;
                return { binding: bindingIndex++, resource: texture.createView() };
            } ).filter( u => u !== undefined ) );
            entries.push( { binding: bindingIndex++, resource: Shader.globalSampler } );
        }

        if( this.type === "compute" )
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
            if( bindings.length )
            {
                baseEntries.push( ...this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    let texture = this.channelTextures[ index ];
                    if( !texture ) return;
                    texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_TEXTURE_B_INDEX ] : texture;
                    return { binding: baseBindingIndex++, resource: texture.createView() };
                } ).filter( u => u !== undefined ) );
                baseEntries.push( { binding: baseBindingIndex++, resource: Shader.globalSampler } );
            }

            if( this.type === "compute" )
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

    async createStorageBindGroup( pipeline )
    {
        if( !pipeline )
        {
            return;
        }

        const entries       = [];

        let bindingIndex    = 0;

        this.storageBuffers.map( ( u, index ) => {
            const buffer = this.storageBuffers[ index ].resource;
            entries.push( {
                binding: bindingIndex++,
                resource: { buffer }
            } );
        } );

        this.storageBindGroup = await this.device.createBindGroup({
            label: "Storage Bind Group A",
            layout: pipeline.getBindGroupLayout( 1 ),
            entries
        });

        console.warn( "Info: Storage Bind Group created!" );

        return this.storageBindGroup;
    }

    async compile( format, buffers )
    {
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
            const bindGroup = await this.createBindGroup( p.pipeline ?? p, buffers );
            p.bindGroup = this.bindGroup;
            p.bindGroupB = this.bindGroupB;
            if( bindGroup?.constructor !== GPUBindGroup )
            {
                return WEBGPU_ERROR;
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
                    return WEBGPU_ERROR;
                }
            }
        }

        this.mustCompile = false;

        return WEBGPU_OK;
    }

    async validate( entryCode )
    {
        const { code, bindings, executeOnce } = this.getShaderCode( true, entryCode );

        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

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
                console.log( entryCode );
                return { valid: false, code, messages: errorMsgs };
            }
        }

        return { valid: true, module, bindings, executeOnce };
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

    isBindingUsed( binding, entryCode )
    {
        const templateCodeLines = [ ...( this.type === "compute" ) ? Shader.COMPUTER_SHADER_TEMPLATE : Shader.RENDER_SHADER_TEMPLATE ];
        const lines = [ ...templateCodeLines, ...( entryCode ? entryCode.split( "\n" ) : this.codeLines ) ];
        return lines.filter( l => l.includes( binding ) ).length > 0;
    }

    getShaderCode( includeBindings = true, entryCode )
    {
        const templateCodeLines = [ ...( this.type === "compute" ) ? Shader.COMPUTER_SHADER_TEMPLATE : Shader.RENDER_SHADER_TEMPLATE ];
        const bindings = {};

        // Invert uv y if buffer render target
        const invertUvsIndex = templateCodeLines.indexOf( "$invert_uv_y" );
        if( invertUvsIndex > -1 )
        {
            templateCodeLines.splice( invertUvsIndex, 1, this.type === "buffer" ? "    output.fragUV.y = 1.0 - output.fragUV.y;" : undefined );
        }

        if( includeBindings )
        {
            let bindingIndex = 0;

            // Default Uniform bindings
            {
                const defaultBindingsIndex = templateCodeLines.indexOf( "$default_bindings" );
                console.assert( defaultBindingsIndex > -1 );
                templateCodeLines.splice( defaultBindingsIndex, 1, ...Constants.DEFAULT_UNIFORMS_LIST.map( ( u, index ) => {
                    if( u.skipBindings ?? false ) return;
                    if( !this.isBindingUsed( u.name, entryCode ) ) return;
                    const binding = bindingIndex++;
                    bindings[ binding ] = u.name;
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
                    return `@group(0) @binding(${ bindingIndex++ }) var<uniform> ${ u.name } : ${ u.type };`;
                } ).filter( u => u !== undefined ) );
            }

            // Process texture bindings
            {
                const textureBindingsIndex = templateCodeLines.indexOf( "$texture_bindings" );
                console.assert( textureBindingsIndex > -1 );
                const bindings = this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var iChannel${ index } : texture_2d<f32>;`;
                } ).filter( u => u !== undefined );
                templateCodeLines.splice( textureBindingsIndex, 1, ...(bindings.length ? [ ...bindings, `@group(0) @binding(${ bindingIndex++ }) var texSampler : sampler;` ] : []) );
            }

            if( this.type === "compute" )
            {
                const outputBindingIndex = templateCodeLines.indexOf( "$output_binding" );
                console.assert( outputBindingIndex > -1 );
                templateCodeLines.splice( outputBindingIndex, 1, `@group(0) @binding(${ bindingIndex++ }) var screen: texture_storage_2d<rgba16float,write>;` );
            }

            // Process some dummies so using them isn't mandatory
            {
                const customDummiesIndex = templateCodeLines.indexOf( "$custom_dummies" );
                console.assert( customDummiesIndex > -1 );
                templateCodeLines.splice( customDummiesIndex, 1, ...this.uniforms.map( ( u, index ) => {
                    if( !u ) return;
                    return `    let u${ u.name }Dummy: ${ u.type } = ${ u.name };`;
                } ).filter( u => u !== undefined ) );

                const textureDummiesIndex = templateCodeLines.indexOf( "$texture_dummies" );
                console.assert( textureDummiesIndex > -1 );
                templateCodeLines.splice( textureDummiesIndex, 1, ...this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    return `    let channel${ index }Dummy: vec4f = textureSample(iChannel${ index }, texSampler, fragUV);`;
                } ).filter( u => u !== undefined ) );
            }
        }

        // Add shader utils depending on bind group
        {
            const features = this.shader.getFeatures();
            const bindings = this.channels.filter( channelName => channelName !== undefined && channelName !== "" );
            const wgslUtilsIndex = templateCodeLines.indexOf( "$wgsl_utils" );
            if( wgslUtilsIndex > -1 )
            {
                const utils = [
                    ...( bindings.length ? Shader.WGSL_TEXTURE_UTILS : [] ),
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
            const lines = [ ...( entryCode ? entryCode.split( "\n" ) : this.codeLines ) ];

            if( this.type === "compute" )
            {
                this.structs        = this.parseStructs( lines.join( "\n" ) );
                this.storageBuffers = [];

                for( let i = 0; i < lines.length; ++i )
                {
                    lines[ i ] = this.parseComputeLine( lines[ i ] );
                }

                const computeEntryIndex = templateCodeLines.indexOf( "$compute_entry" );
                console.assert( computeEntryIndex > -1 );
                templateCodeLines.splice( computeEntryIndex, 1, `@compute @workgroup_size(${ this.workGroupSize })` );
            }

            const mainImageIndex = templateCodeLines.indexOf( "$main_entry" );
            console.assert( mainImageIndex > -1 );
            templateCodeLines.splice( mainImageIndex, 1, ...lines );
        }

        const shaderResult = { code: templateCodeLines.join( "\n" ), bindings, executeOnce: this.executeOnce };

        // delete tmp context
        delete this.structs;
        delete this.executeOnce;

        return shaderResult;
    }

    getStorageTypeSize( type )
    {
        // for now only support arrays and native types
        if( type.startsWith( "array" ) )
        {
            const matches = [...type.matchAll(/<([^>]+)>/g)].map(m => m[1]);
            type = matches[ 0 ];
            const ts = type.split( "," );
            let size = Shader.GetUniformSize( ts[ 0 ] );
            // unknown type, must be a custom type
            if( size === 0 )
            {
                size = this.structs[ ts[ 0 ] ]?.size ?? 0;
            }

            if( ts.length === 1 )
            {
                return size;
            }
            else
            {
                const count = parseInt( ts[ 1 ] );
                return size * count;
            }
        }
        else
        {
            return Shader.GetUniformSize( type );
        }
    }

    computeStructSize( members )
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

    parseStructs( code )
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
            const { size, stride } = this.computeStructSize( members );
            structs[ name ] = { name, members, size, stride };
        }

        return structs;
    }

    parseComputeLine( line )
    {
        const tokens = line.split( " " );

        if( line.startsWith( "#workgroup_size" ) )
        {
            this.workGroupSize = [ parseInt( tokens[ 1 ] ), parseInt( tokens[ 2 ] ?? "16" ), parseInt( tokens[ 3 ] ?? "1" ) ];
            return "";
        }
        else if( line.startsWith( "#dispatch_once" ) )
        {
            this.executeOnce = tokens[ 1 ];
            return "";
        }
        else if( line.startsWith( "#storage" ) )
        {
            // Parse name and type and create storage buffer
            const bufferName = tokens[ 1 ];
            const bufferType = tokens.slice( 2 ).join( " " ); // All starting from the 2nd index
            const bufferSize = this.getStorageTypeSize( bufferType );

            const storageBuffer = this.device.createBuffer({
                label: `${ bufferName} (storage)`,
                size: bufferSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            });

            const index = this.storageBuffers.length;
            this.storageBuffers.push( { name: bufferName, size: bufferSize, resource: storageBuffer } );
            return `@group(1) @binding(${ index }) var<storage, read_write> ${ bufferName }: ${ bufferType };`;
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

Shader.WGSL_TEXTURE_UTILS = `fn texture( texture: texture_2d<f32>, uv: vec2f ) -> vec4f {
    return textureSample( texture, texSampler, uv );
}`.split( "\n" );

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
$invert_uv_y
    output.fragCoord = output.fragUV * iResolution;
    var time_dummy : f32 = iTime;
    return output;
}

// Constants
const PI : f32 = 3.14159265359;

$wgsl_utils
$common
$main_entry

@fragment
fn frag_main(@location(0) fragUV : vec2f, @location(1) fragCoord : vec2f) -> @location(0) vec4f {
$custom_dummies
$texture_dummies
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
$custom_dummies
$texture_dummies
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

    // Convert from gamma-encoded to linear colour space
    col = pow(col, vec3f(2.2));

    // Output to screen (linear colour space)
    textureStore(screen, id.xy, vec4f(col, 1.0));
}`.split( "\n" );

export { Shader, ShaderPass, FPSCounter };
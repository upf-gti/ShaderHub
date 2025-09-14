import * as Constants from "./constants.js";
import { ShaderHub } from './app.js';

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

    constructor( shader, device, data ) {

        this.shader = shader;
        this.name = data.name;
        this.device = device;
        this.type = data.type ?? "image";
        this.channels = data.channels ?? [];
        this.codeLines = data.codeLines ?? this.shader.getDefaultCode( this );
        this.uniforms = data.uniforms ?? [];
        this.uniformBuffers = [];

        this.pipeline = null;
        this.bindGroup = null;

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
    }

    async draw( format, ctx, buffers, textures )
    {
        if( this.type === "common" )
        {
            return;
        }

        if( !this.pipeline )
        {
            await this.createPipeline( format );
        }

        if( !this.bindGroup )
        {
            await this.createBindGroup( buffers, textures );
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

            const inputTex = this.textures[this.frameCount % 2]; // previous frame
            const renderTarget = this.textures[(this.frameCount + 1) % 2]; // this frame
            const commandEncoder = this.device.createCommandEncoder();
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

            if( this.bindGroup )
            {
                passEncoder.setBindGroup( 0, this.bindGroup );
            }

            passEncoder.draw( 6 );
            passEncoder.end();

            this.device.queue.submit( [ commandEncoder.finish() ] );

            this.frameCount++;

            return [ renderTarget, inputTex ];
        }
    }

    async createPipeline( format )
    {
        if( this.type === "common" ) return;

        const result = await ShaderHub.validateShader( this.getShaderCode() );
        if( !result.valid )
        {
            return result;
        }

        this.pipeline = await this.device.createRenderPipeline({
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
            },
        });

        console.warn( "Info: Render Pipeline created!" );

        return this.pipeline;
    }

    async createBindGroup( buffers, textures )
    {
        if( !this.pipeline )
        {
            return;
        }

        let bindingIndex = 0;

        const entries = [
            {
                binding: bindingIndex++,
                resource: { buffer: buffers[ "time" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: buffers[ "timeDelta" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: buffers[ "frameCount" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: buffers[ "resolution" ] }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: buffers[ "mouse" ] }
            }
        ]

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
                    resource: {
                        buffer,
                    }
                } );
            } );
        }

        const bindings = this.channels.filter( u => u !== undefined && textures[ u ] );

        if( bindings.length )
        {
            entries.push( ...this.channels.map( ( channelName, index ) => {
                if( !channelName ) return;
                let texture = textures[ channelName ];
                if( !texture ) return;
                texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_BIND_TEXTURE_INDEX ] : texture;
                return { binding: bindingIndex++, resource: texture.createView() };
            } ).filter( u => u !== undefined ) );
            entries.push( { binding: bindingIndex++, resource: this.sampler } );
        }

        this.bindGroup = await this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout( 0 ),
            entries
        });

        console.warn( "Info: Render Bind Group created!" );

        return this.bindGroup;
    }

    async compile( format, buffers, textures )
    {
        const p = await this.createPipeline( format );
        if( p?.constructor !== GPURenderPipeline )
        {
            return p;
        }

        const bg = await this.createBindGroup( buffers, textures );
        if( bg?.constructor !== GPUBindGroup )
        {
            return WEBGPU_ERROR;
        }
        
        return WEBGPU_OK;
    }

    getShaderCode( includeBindings = true )
    {
        const templateCodeLines = [ ...( this.shader.type === "render" ) ? Shader.RENDER_SHADER_TEMPLATE : Shader.COMPUTER_SHADER_TEMPLATE ];

        if( includeBindings )
        {
            let bindingIndex = 0;

            // Default Uniform bindings
            {
                const defaultBindingsIndex = templateCodeLines.indexOf( "$default_bindings" );
                console.assert( defaultBindingsIndex > -1 );
                templateCodeLines.splice( defaultBindingsIndex, 1, ...Constants.DEFAULT_UNIFORMS_LIST.map( ( u, index ) => {
                    if( u.skipBindings ?? false ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var<uniform> ${ u.name } : ${ u.type };`;
                } ).filter( u => u !== undefined ) );
            }

            // Custom Uniform bindings
            {
                if( this.uniforms.length !== this.uniformBuffers.length )
                {
                    this.uniformBuffers.length = this.uniforms.length; // Set new length

                    for( let i = 0; i < this.uniformBuffers.length; ++i )
                    {
                        const buffer = this.uniformBuffers[ i ];
                        if( !buffer )
                        {
                            this.uniformBuffers[ i ] = this.device.createBuffer({
                                size: 4,
                                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
                            });
                        }
                    }
                }

                const customBindingsIndex = templateCodeLines.indexOf( "$custom_bindings" );
                console.assert( customBindingsIndex > -1 );
                templateCodeLines.splice( customBindingsIndex, 1, ...this.uniforms.map( ( u, index ) => {
                    if( !u ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var<uniform> ${ u.name } : f32;`;
                } ).filter( u => u !== undefined ) );
            }

            // Process texture bindings
            {
                const textureBindingsIndex = templateCodeLines.indexOf( "$texture_bindings" );
                console.assert( textureBindingsIndex > -1 );
                const bindings = this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    // const texture = this.textures[ channelName ] ?? this.buffers[ channelName ][ BUFFER_PASS_BIND_TEXTURE_INDEX ];
                    // if( !texture ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var iChannel${ index } : texture_2d<f32>;`;
                } ).filter( u => u !== undefined );
                templateCodeLines.splice( textureBindingsIndex, 1, ...(bindings.length ? [ ...bindings, `@group(0) @binding(${ bindingIndex++ }) var texSampler : sampler;` ] : []) );
            }

            // Process dummies so using them isn't mandatory
            {
                const defaultDummiesIndex = templateCodeLines.indexOf( "$default_dummies" );
                console.assert( defaultDummiesIndex > -1 );
                templateCodeLines.splice( defaultDummiesIndex, 1, ...Constants.DEFAULT_UNIFORMS_LIST.map( ( u, index ) => {
                    if( u.skipBindings ?? false ) return;
                    return `    let u${ u.name }Dummy: ${ u.type } = ${ u.name };`;
                } ).filter( u => u !== undefined ) );

                const customDummiesIndex = templateCodeLines.indexOf( "$custom_dummies" );
                console.assert( customDummiesIndex > -1 );
                templateCodeLines.splice( customDummiesIndex, 1, ...this.uniforms.map( ( u, index ) => {
                    if( !u ) return;
                    return `    let u${ u.name }Dummy: f32 = ${ u.name };`;
                } ).filter( u => u !== undefined ) );

                const textureDummiesIndex = templateCodeLines.indexOf( "$texture_dummies" );
                console.assert( textureDummiesIndex > -1 );
                templateCodeLines.splice( textureDummiesIndex, 1, ...this.channels.map( ( channelName, index ) => {
                    if( !channelName ) return;
                    // const texture = this.textures[ channelName ] ?? this.buffers[ channelName ][ BUFFER_PASS_BIND_TEXTURE_INDEX ];
                    // if( !texture ) return;
                    return `    let channel${ index }Dummy: vec4f = textureSample(iChannel${ index }, texSampler, fragUV);`;
                } ).filter( u => u !== undefined ) );
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

        // Add main image
        {
            const mainImageIndex = templateCodeLines.indexOf( "$main_image" );
            console.assert( mainImageIndex > -1 );
            templateCodeLines.splice( mainImageIndex, 1, ...this.codeLines );
        }

        return templateCodeLines.join( "\n" );
    }

    resizeBuffer( resolutionX, resolutionY ) {

        const oldResolution = this.resolution;
        if( ( oldResolution[ 0 ] === resolutionX ) || ( oldResolution[ 1 ] === resolutionY ) )
            return;

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
}

class Shader {

    constructor( data ) {

        this.name = data.name ?? "";
        this.uid = data.uid;
        this.url = data.url;
        this.passes = data.passes ?? [];
        this.type = "render";

        this.author = data.author ?? "anonymous";
        this.authorId = data.authorId;
        this.anonAuthor = data.anonAuthor ?? false;
        this.description = data.description ?? "";
        this.creationDate = data.creationDate ?? "";
        this.hasPreview = data.hasPreview ?? false;
    }

    getDefaultCode( pass ) {

        if( this.type === "render" )
        {
            return ( pass.type === "buffer" ? Shader.RENDER_BUFFER_TEMPLATE : Shader.RENDER_COMMON_TEMPLATE )
        }
        else if( this.type === "compute" )
        {
            return "";
        }
    }
}

Shader.RENDER_SHADER_TEMPLATE = [
    "$default_bindings",
    "$custom_bindings",
    "$texture_bindings",
    "",
    "struct VertexOutput {",
    "    @builtin(position) Position : vec4f,",
    "    @location(0) fragUV : vec2f,",
    "    @location(1) fragCoord : vec2f,",
    "}",
    "",
    "@vertex",
    "fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {",
    "",
    "    const pos = array(",
    "        vec2(-1.0, -1.0),",
    "        vec2( 1.0, -1.0),",
    "        vec2(-1.0,  1.0),",
    "        vec2(-1.0,  1.0),",
    "        vec2( 1.0, -1.0),",
    "        vec2( 1.0,  1.0),",
    "    );",
    "",
    "    var output : VertexOutput;",
    "    output.Position = vec4(pos[VertexIndex], 0.0, 1.0);",
    "    output.fragUV = (output.Position.xy * 0.5) + vec2(0.5, 0.5);",
    "    output.fragUV.y = 1.0 - output.fragUV.y;",
    "    output.fragCoord = output.fragUV * iResolution;",
    "",
    "    var time_dummy : f32 = iTime;",
    "",
    "    return output;",
    "}",
    "",
    "const PI : f32 = 3.14159265359;",
    "",
    "$common",
    "$main_image",
    "",
    "@fragment",
    "fn frag_main(@location(0) fragUV : vec2f, @location(1) fragCoord : vec2f) -> @location(0) vec4f {",
    "",
    "$default_dummies",
    "$custom_dummies",
    "$texture_dummies",
    "",
    "    return mainImage(fragUV, fragCoord);",
    "}"
];

Shader.RENDER_MAIN_TEMPLATE = [
    "fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {",
    "    // Normalized pixel coordinates (from 0 to 1)",
    "    let uv : vec2f = fragUV; // The same as: fragCoord/iResolution.xy;",
    "",
    "    // Time varying pixel color",
    "    let color : vec3f = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0,2,4));",
    "",
    "    // Output to screen",
    "    return vec4f(color, 1.0);",
    "}",
];

Shader.RENDER_COMMON_TEMPLATE = [
    "fn someFunc(a: f32, b: f32) -> f32 {",
    "    return a + b;",
    "}"
];

Shader.RENDER_BUFFER_TEMPLATE = [
    "fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {",
    "    // Output to screen",
    "    return vec4f(0.0, 0.0, 1.0, 1.0);",
    "}"
];

/*
    Compute Shaders
*/

Shader.COMPUTER_SHADER_TEMPLATE = [];

export { Shader, ShaderPass, FPSCounter };
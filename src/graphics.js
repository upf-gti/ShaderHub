// Each shader pass corresponds to a shader file
class ShaderPass {

    constructor( device, data ) {
        this.name = data.name;
        this.type = data.type ?? "image";
        this.codeLines = data.codeLines;

        this.channels = data.channels ?? [];

        this.uniforms = data.uniforms ?? [];
        this.uniformBuffers = [];

        this.frameCount = 0;

        if( this.type === "buffer" )
        {
            this.textures = [
                device.createTexture({
                    label: "Buffer Pass Texture A",
                    size: [ 1280, 720, 1 ],
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                }),
                device.createTexture({
                    label: "Buffer Pass Texture B",
                    size: [ 1280, 720, 1 ],
                    format: navigator.gpu.getPreferredCanvasFormat(),
                    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
                })
            ];
        }
    }

    draw( device, ctx, renderPipeline, renderBindGroup ) {

        if( this.type === "common" )
        {
            return;
        } 
        else if( this.type === "image" )
        {
            if( !renderPipeline )
            {
                return;
            }

            const commandEncoder = device.createCommandEncoder();
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
            passEncoder.setPipeline( renderPipeline );

            if( renderBindGroup )
            {
                passEncoder.setBindGroup( 0, renderBindGroup );
            }

            passEncoder.draw( 6 );
            passEncoder.end();

            device.queue.submit( [ commandEncoder.finish() ] );
        }
        else if( this.type === "buffer" )
        {
            if( !renderPipeline || !this.textures[ 0 ] || !this.textures[ 1 ] )
            {
                return;
            }

            const inputTex = this.textures[this.frameCount % 2]; // previous frame
            const renderTarget = this.textures[(this.frameCount + 1) % 2]; // this frame
            const commandEncoder = device.createCommandEncoder();
            const textureView = renderTarget.createView();
            console.log("Render target texture:", renderTarget.label );

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
            passEncoder.setPipeline( renderPipeline );

            if( renderBindGroup )
            {
                passEncoder.setBindGroup( 0, renderBindGroup );
            }

            passEncoder.draw( 6 );
            passEncoder.end();

            device.queue.submit( [ commandEncoder.finish() ] );

            this.frameCount++;

            return [ renderTarget, inputTex ];
        }
    }
}

class Shader {

    constructor( data ) {

        this.name = data.name ?? "";
        this.uid = data.uid;
        this.url = data.url;
        this.passes = data.passes ?? [];

        // Remove this once everything is moved to ShaderPass
        this.uniforms = [];

        this.author = data.author ?? "anonymous";
        this.authorId = data.authorId;
        this.anonAuthor = data.anonAuthor ?? false;
        this.description = data.description ?? "";
        this.creationDate = data.creationDate ?? "";
        this.hasPreview = data.hasPreview ?? false;
    }
}

export { Shader, ShaderPass };
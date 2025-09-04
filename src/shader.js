class Shader {

    constructor( data ) {

        this.name = data.name ?? "";
        this.uid = data.uid ?? "";
        this.files = data.files ?? [];
        this.channels = data.channels ?? [];
        this.uniforms = data.uniforms ?? [];
        this.uniformBuffers = [];

        this.author = data.author ?? "anonymous";
        this.authorId = data.authorId;
        this.anonAuthor = data.anonAuthor ?? false;
        this.description = data.description ?? "";
        this.lastUpdatedDate = "";
        this.hasPreview = data.hasPreview ?? false
    }
}

export { Shader };
class FS {

    static PROJECT_ID = "68b709f30027f98a667b";
    static END_POINT = "https://cloud.appwrite.io/v1";

    static DATABASE_ID = "68b70c8f002d2fe08d90";
    static BUCKET_ID = "68b70c6b0004ae91e454";
    static SHADERS_COLLECTION_ID = "shaders";
    static USERS_COLLECTION_ID = "users";
    static ASSETS_COLLECTION_ID = "assets";
    static INTERACTIONS_COLLECTION_ID = "interactions";

    constructor() {
        this.client = new Appwrite.Client()
            .setEndpoint( FS.END_POINT )
            .setProject( FS.PROJECT_ID );

        this.account = new Appwrite.Account( this.client );
        this.databases = new Appwrite.Databases( this.client );
        this.storage = new Appwrite.Storage( this.client );
    }

    getUserId() {
        return this.user[ "$id" ];
    }

    async detectAutoLogin() {
        try {
            this.user = await this.account.get();
            this.session = await this.account.getSession( "current" );
            console.log( "Autologged", this.user );
        } catch (err) {
            // No session
            console.warn( "No current session" );
        }
    }

    async createAccount( email, password, name, oncreate, onerror  ) {
        console.assert( email && password && name );
        await this.account.create( {
            userId: "unique()",
            email,
            password,
            name
        }).then( user => {
            if( oncreate ) oncreate( user );
        } )
        .catch( error => {
            console.error( error );
            if( onerror ) onerror( error?.message );
        } );
    }

    async login( email, password, onlogin, onerror ) {
        await this.account.createEmailPasswordSession({
            email,
            password
        }).then( async session => {
            this.user = await this.account.get();
            this.session = session;
            console.log( "Login", this.user );
            if( onlogin ) onlogin( this.user, this.session );
        })
        .catch( error => {
            if( onerror ) onerror( error?.message );
        } );
    }

    async logout() {
        if( !this.user )
        {
            return;
        }
        try {
            const current = await this.account.getSession( "current" );
            await this.account.deleteSession({
                sessionId: current["$id"]
            });

            this.user = null;

            console.log( "Logged out!" );
        } catch( err ) {
            console.error( err );
        }
    }

    async listDocuments( collectionId, queries = [] ) {
        return await this.databases.listDocuments({
            databaseId: FS.DATABASE_ID,
            collectionId,
            queries
        });
    }

    async getDocument( collectionId, documentId ) {
        return await this.databases.getDocument({
            databaseId: FS.DATABASE_ID,
            collectionId,
            documentId
        });
    }

    async createDocument( collectionId, data ) {
        return await this.databases.createDocument({
            databaseId: FS.DATABASE_ID,
            collectionId,
            documentId: "unique()",
            data
        });
    }

    async updateDocument( collectionId, documentId, data ) {
        return await this.databases.updateDocument({
            databaseId:FS.DATABASE_ID,
            collectionId,
            documentId,
            data
        });
    }

    async deleteDocument( collectionId, documentId ) {
        return await this.databases.deleteDocument({
            databaseId: FS.DATABASE_ID,
            collectionId,
            documentId
        });
    }

    async listFiles( queries = [] ) {
        return await this.storage.listFiles({
            bucketId: FS.BUCKET_ID,
            queries
        });
    }

    async getFile( fileId ) {
        return await this.storage.getFile({
            bucketId: FS.BUCKET_ID,
            fileId
        });
    }

    async getFileUrl( fileId ) {
        return await this.storage.getFileView({
            bucketId: FS.BUCKET_ID,
            fileId
        });
    }

    async getFileContent( fileId ) {
        const url = await this.getFileUrl( fileId );
        return await this.requestFile( url );
    }

    async createFile( file, fileId ) {
        return await this.storage.createFile({
            bucketId: FS.BUCKET_ID,
            fileId: fileId ?? "unique()",
            file
        });
    }

    async deleteFile( fileId ) {
        return await this.storage.deleteFile({
            bucketId: FS.BUCKET_ID,
            fileId
        });
    }

    async getImagePreview( fileId, options ) {
        return await this.storage.getFilePreview({
            bucketId: FS.BUCKET_ID,
            fileId,
            ...options
        });
    }

    async requestFile( url, dataType, nocache ) {

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

export { FS };
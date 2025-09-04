class FS {

    static PROJECT_ID = "68b709f30027f98a667b";
    static END_POINT = "https://cloud.appwrite.io/v1";

    static DATABASE_ID = "68b70c8f002d2fe08d90";
    static BUCKET_ID = "68b70c6b0004ae91e454";
    static SHADERS_COLLECTION_ID = "shaders";
    static USERS_COLLECTION_ID = "users";

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

    async createAccount( mail, password, name ) {
        console.assert( mail && password && name );
        await this.account.create('unique()', mail, password, name )
          .then( response => console.log( response ) )
          .catch( error => console.error( error) );
    }

    async login( mail, password, onlogin, onerror ) {
        await this.account.createEmailPasswordSession( mail ?? "public@shaderhub.com", password ?? "password123" )
            .then( async session => {
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

    async getDocument( collectionId, docId ) {
        return await this.databases.getDocument( FS.DATABASE_ID, collectionId, docId );
    }

    async createDocument( collectionId, docRow ) {
        return await this.databases.createDocument(
            FS.DATABASE_ID,
            collectionId,
            "unique()",
            docRow
        );
    }

    async updateDocument( collectionId, documentId, docRow ) {
        return await this.databases.updateDocument(
            FS.DATABASE_ID,
            collectionId,
            documentId,
            docRow
        );
    }

    async listFiles( queries = [] ) {
        return await this.storage.listFiles({
            bucketId: FS.BUCKET_ID,
            queries
        });
    }

    async getFile( fileId ) {
        return await this.storage.getFile( FS.BUCKET_ID, fileId );
    }

    async getFileUrl( fileId ) {
        return await this.storage.getFileDownload({
            bucketId: FS.BUCKET_ID,
            fileId
        });
    }

    async getFileContent( fileId ) {
        const url = await this.getFileUrl( fileId );
        return await this.requestFile( url );
    }

    async createFile( file, fileId ) {
        return await this.storage.createFile( {
            bucketId: FS.BUCKET_ID,
            fileId: fileId ?? "unique()",
            file
        });
    }

    async deleteFile( fileId ) {
        return await this.storage.deleteFile( {
            bucketId: FS.BUCKET_ID,
            fileId
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
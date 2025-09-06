import { LX } from 'lexgui';
// import 'lexgui/extensions/codeeditor.js';
import './extra/codeeditor.js';
import { FS } from './fs.js';
import { Shader } from './shader.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const SHADER_MODE_VIEW  = 0;
const SHADER_MODE_EDIT  = 1;

const USERNAME_MIN_LENGTH = 3;
const PASSWORD_MIN_LENGTH = 8;

const UNIFORM_CHANNELS_COUNT = 4;
const DEFAULT_UNIFORMS_LIST = [
    { name: "iTime", type: "f32" },
    { name: "iFrame", type: "i32" },
    { name: "iResolution", type: "vec2f" },
];
const DEFAULT_UNIFORM_NAMES = DEFAULT_UNIFORMS_LIST.map( u => u.name );

const SRC_IMAGE_EMPTY = "data:image/gif;base64,R0lGODlhAQABAPcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAAP8ALAAAAAABAAEAAAgEAP8FBAA7";

const fs = new FS();
const Query = Appwrite.Query;
const mobile = navigator && /Android|iPhone/i.test( navigator.userAgent );

function capitalizeFirstLetter(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

const ShaderHub = {

    shaderList: [],
    loadedFiles: {},
    loadedImages: {},
    uniformChannels: [],

    frameCount: 0,
    lastTime: 0,
    elapsedTime: 0,
    timePaused: false,

    async initUI() {

        this.area = await LX.init();

        await fs.detectAutoLogin();

        const starterTheme = LX.getTheme();
        const menubarOptions = [];
        const menubarButtons = [
            {
                title: "Switch Theme",
                icon: starterTheme == "dark" ? "Moon" : "Sun",
                swap: starterTheme == "dark" ? "Sun" : "Moon",
                callback: (value, event) => { LX.switchTheme() }
            }
        ];

        if( !mobile )
        {
            menubarOptions.push(
                {
                    name: "New", callback: () => this.createNewShader()
                },
                {
                    name: "Browse", callback: () => window.location.href = `${ window.location.origin + window.location.pathname }`
                }
            );
        }

        const menubar = this.area.addMenubar( menubarOptions );

        if( mobile )
        {
            const sidebarOptions = {
                headerTitle: fs.user ? fs.user.name : "Guest",
                headerSubtitle: fs.user ? fs.user.email : undefined,
                headerImage: "images/favicon.png",
                skipFooter: true,
                collapsed: false,
                collapsable: false,
                displaySelected: true
            };

            const sidebarCallback = m => {
                if( fs.user )
                {
                    m.add( "Profile", { icon: "User", callback: this.openProfile.bind( this, fs.getUserId() ) } );
                    m.add( "Browse", { icon: "Search", callback: () => window.location.href = `${ window.location.origin + window.location.pathname }` } );
                    m.add( "Logout", { icon: "LogOut", callback: async () => {
                        await fs.logout();
                    } } );
                    m.separator();
                }
                else
                {
                    m.add( "Login", { icon: "LogIn", callback: this.openLoginDialog.bind( this ) } );
                    m.add( "Create account", { icon: "UserPlus", callback: this.openSignUpDialog.bind( this ) } );
                }

                m.add( "New Shader", { icon: "UserPlus", callback: this.createNewShader.bind( this ) } );
            }

            const sheetArea = new LX.Area({ skipAppend: true });
            sheetArea.addSidebar( sidebarCallback, sidebarOptions );

            menubar.addButtons( menubarButtons );

            menubar.setButtonIcon( "Menu", "Menu", () => window.__currentSheet = new LX.Sheet("256px", [ sheetArea ], { side: "right" } ) );
        }
        else
        {
            menubar.addButtons( menubarButtons );

            if( !fs.user )
            {
                const signupContainer = LX.makeContainer( [`auto`, "auto"], "flex flex-row p-1 gap-1 self-center items-center", "", menubar.root );
                signupContainer.id = "signupContainer";
                const signupOptionsButton = LX.makeContainer( [`auto`, "auto"], "p-1 rounded-lg fg-primary hover:bg-tertiary text-md self-center items-center cursor-pointer", "Create account", signupContainer );
                signupOptionsButton.addEventListener( "click", async (e) => {
                    e.preventDefault();
                    this.openSignUpDialog();
                } );
                LX.makeContainer( [`auto`, "0.75rem"], "mx-2 border-right border-colored fg-quaternary self-center items-center", "", signupContainer );
            }

            const loginOptionsButton = LX.makeContainer( [`auto`, "auto"], "flex flex-row gap-1 p-1 mr-2 rounded-lg fg-primary hover:bg-tertiary text-md self-center items-center cursor-pointer", `
                ${ fs.user ? `<span class="decoration-none fg-secondary">${ fs.user.email }</span>${ LX.makeIcon("ChevronsUpDown", { iconClass: "pl-2" } ).innerHTML }` : "Login" }`, menubar.root );
            loginOptionsButton.id = "loginOptionsButton";
            loginOptionsButton.addEventListener( "click", async (e) => {
                e.preventDefault();
                if( fs.user )
                {
                    new LX.DropdownMenu( loginOptionsButton, [
                        fs.user.name,
                        null,
                        { name: "Profile", icon: "User", callback: this.openProfile.bind( this, fs.getUserId() ) },
                        { name: "Logout", icon: "LogOut", className: "fg-error", callback: async () => {
                            await fs.logout();
                            loginOptionsButton.innerHTML = "Login";
                            document.getElementById( "signupContainer" ).classList.remove( "hidden" );
                        } },
                    ], { side: "bottom", align: "end" });
                }
                else
                {
                    this.openLoginDialog();
                }
            } );
        }

        menubar.setButtonImage("ShaderHub", `images/icon_${ starterTheme }.png`, null, { float: "left" } );

        LX.addSignal( "@on_new_color_scheme", ( el, value ) => {
            menubar.setButtonImage("ShaderHub", `images/icon_${ value }.png`, null, { float: "left" } );
        } );

        menubar.siblingArea.root.classList.add( "content-area" );

        const onLoad = async () => {
            const params = new URLSearchParams( document.location.search );
            const queryShaderView = params.get( "view" );
            const queryShaderEdit = params.get( "edit" );
            const queryProfile = params.get( "profile" );
            if( queryShaderView )
            {
                await this.createShaderView( queryShaderView, SHADER_MODE_VIEW );
            }
            else if( queryShaderEdit )
            {
                await this.createShaderView( queryShaderEdit, SHADER_MODE_EDIT );
            }
            else if( queryProfile )
            {
                this.createProfileView( queryProfile );
            }
            else
            {
                this.createBrowseListUI();
            }
        }

        // Get all stored shader files (not the code, only the data)

        const result = await fs.listDocuments( FS.SHADERS_COLLECTION_ID, [
            // Query.equal( "author_id", "68b7102e36d6b0bf564a" ),
            // Query.greaterThan('year', 1999)
        ] );

        if( result.total === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shaders found.", this.area );
            return;
        }

        for( const document of result.documents )
        {
            const name = document.name;

            const shaderInfo = {
                name,
                uid: document[ "$id" ]
            };

            const authorId = document[ "author_id" ];
            if( authorId )
            {
                const result = await fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorId ) ] );
                const author = result.documents[ 0 ][ "user_name" ];
                shaderInfo.author = author;
                shaderInfo.authorId = authorId;
            }
            else
            {
                shaderInfo.author = document[ "author_name" ];
                shaderInfo.anonAuthor = true;
            }

            const previewName = `${ name.replaceAll( " ", "_" ) }_preview.png`;
            const result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
            if( result.total > 0 )
            {
                shaderInfo.preview = await fs.getFileUrl( result.files[ 0 ][ "$id" ] );
            }

            this.shaderList.push( shaderInfo );
        }

        await onLoad();
    },

    createBrowseListUI() {

        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.className += " overflow-scroll";
        bottomArea.root.className += " items-center content-center";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 self-center align-center ml-auto mr-auto", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea );

        const listContainer = LX.makeContainer( ["100%", "auto"], "grid shader-list gap-8 p-8 justify-center", "", topArea );

        for( const shader of this.shaderList ?? [] )
        {
            const shaderItem = LX.makeElement( "li", "shader-item rounded-lg bg-secondary hover:bg-tertiary overflow-hidden flex flex-col h-auto", "", listContainer );
            const shaderPreview = LX.makeElement( "img", "rounded-t-lg bg-secondary hover:bg-tertiary w-full border-none cursor-pointer", "", shaderItem );
            shaderPreview.src = shader.preview ?? "images/shader_preview.png";
            const shaderDesc = LX.makeContainer( ["100%", "100%"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                <div class="w-full">
                    <div class="text-lg font-bold"><span style="font-family:var(--global-code-font);">${ shader.name }</span></div>
                    <div class="text-sm font-light"><span style="font-family:var(--global-code-font);">by
                        ${ !shader.anonAuthor ? "<a class='dodgerblue cursor-pointer hover:text-underline'>" : "" }<span class="font-bold">${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" }</span>
                    </div>
                </div>
                <div class="">
                    <div class="">
                        ${ LX.makeIcon( "CircleUserRound", { svgClass: "xxl fg-secondary" } ).innerHTML }
                    </div>
                </div>`, shaderItem );
                // <img alt="avatar" width="32" height="32" decoding="async" data-nimg="1" class="rounded-full" src="https://imgproxy.compute.toys/insecure/width:64/plain/https://hkisrufjmjfdgyqbbcwa.supabase.co/storage/v1/object/public/avatar/f91bbd73-7734-49a9-99ce-460774d4ccc0/avatar.jpg">

            const hyperlink = shaderDesc.querySelector( "a" );
            if( hyperlink )
            {
                hyperlink.addEventListener( "click", (e) => {
                    e.preventDefault();
                    this.openProfile( shader.authorId )
                } )
            }

            shaderPreview.addEventListener( "click", ( e ) => {
                const mode = ( shader.authorId === fs.getUserId() ) ? "edit" : "view";
                window.location.href = `${ window.location.origin + window.location.pathname }?${ mode }=${ shader.uid }`;
            } );
        }

        if( listContainer.childElementCount === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
        }
    },

    async createProfileView( userID ) {

        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.className += " overflow-scroll";
        bottomArea.root.className += " items-center content-center";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 self-center align-center ml-auto mr-auto", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea );

        const users = await fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", userID ) ] );
        if( users.total === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No user found.", topArea );
            return;
        }

        const user = users.documents[ 0 ];
        const userName = user[ "user_name" ];
        const ownProfile = ( userID === fs.getUserId() );

        document.title = `${ userName } - ShaderHub`;

        const infoContainer = LX.makeContainer( ["100%", "auto"], "gap-8 p-8 justify-center", `
           <div class="text-xxl font-bold"><span style="font-family:var(--global-code-font);">${ userName }</span></div>
        `, topArea );
        const listContainer = LX.makeContainer( ["100%", "auto"], "grid shader-list gap-8 p-8 justify-center", "", topArea );

        const result = await fs.listDocuments( FS.SHADERS_COLLECTION_ID, [
            Query.equal( "author_id", userID )
        ] );

        if( result.total === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
            return;
        }

        for( const document of result.documents )
        {
            const name = document.name;

            const shaderInfo = {
                name,
                uid: document[ "$id" ]
            };

            const previewName = `${ name.replaceAll( " ", "_" ) }_preview.png`;
            const result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
            if( result.total > 0 )
            {
                shaderInfo.preview = await fs.getFileUrl( result.files[ 0 ][ "$id" ] );
            }

            const shaderItem = LX.makeElement( "li", "shader-item shader-profile rounded-lg bg-secondary hover:bg-tertiary overflow-hidden flex flex-col h-auto", "", listContainer );
            const shaderPreview = LX.makeElement( "img", "rounded-t-lg bg-secondary hover:bg-tertiary w-full border-none cursor-pointer", "", shaderItem );
            shaderPreview.src = shaderInfo.preview ?? "images/shader_preview.png";
            const shaderDesc = LX.makeContainer( ["100%", "100%"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                <div class="w-full">
                    <div class="text-lg font-bold"><span style="font-family:var(--global-code-font);">${ shaderInfo.name }</span></div>
                </div>
                <div class="">
                    <div class="">
                        ${ LX.makeIcon( "CircleUserRound", { svgClass: "xxl fg-secondary" } ).innerHTML }
                    </div>
                </div>`, shaderItem );
                // <img alt="avatar" width="32" height="32" decoding="async" data-nimg="1" class="rounded-full" src="https://imgproxy.compute.toys/insecure/width:64/plain/https://hkisrufjmjfdgyqbbcwa.supabase.co/storage/v1/object/public/avatar/f91bbd73-7734-49a9-99ce-460774d4ccc0/avatar.jpg">

            shaderPreview.addEventListener( "click", ( e ) => {
                const mode = ownProfile ? "edit" : "view";
                window.location.href = `${ window.location.origin + window.location.pathname }?${ mode }=${ shaderInfo.uid }`;
            } );
        }

        if( listContainer.childElementCount === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
        }
    },

    async createShaderView( shaderUid, mode ) {

        // Create shader instance based on shader uid
        // Get all stored shader files (not the code, only the data)
        if( shaderUid !== "new" )
        {
            let result;

            try {
                result = await fs.getDocument( FS.SHADERS_COLLECTION_ID, shaderUid );
            } catch (error) {
                LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shader found.", this.area );
                return;
            }

            const fileIdString = result[ "file_id" ];
            const fileIds = fileIdString.split( "," );
            const files = [];

            for( const fileId of fileIds )
            {
                const metadata = await fs.getFile( fileId );
                const url = await fs.getFileUrl( fileId );
                files.push( [ url, metadata.name ] );
            }

            const shaderData = {
                name: result.name,
                uid: shaderUid,
                files,
                channels: JSON.parse( result[ "channels" ] ),
                uniforms: JSON.parse( result[ "uniforms" ] ),
                description: result.description ?? ""
            };

            const authorId = result[ "author_id" ];
            if( authorId )
            {
                const users = await fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorId ) ] );
                const authorName = users.documents[ 0 ][ "user_name" ];
                shaderData.author = authorName;
                shaderData.authorId = authorId;
            }
            else
            {
                shaderData.author = result[ "author_name" ];
                shaderData.anonAuthor = true;
            }

            this.shader = new Shader( shaderData );
        }
        else
        {
            const name = "New Shader";
            const mainShaderUrl = "shaders/main.template.wgsl";

            if( !this.loadedFiles[ mainShaderUrl ] )
            {
                const arraybuffer = await fs.requestFile( mainShaderUrl );
                const code = new TextDecoder().decode( arraybuffer );
                this.loadedFiles[ mainShaderUrl ] = code;
            }

            const shaderData = {
                name: name,
                uid: "EMPTY_ID",
                files: [ [ "shaders/main.template.wgsl", "main.wgsl" ] ],
                author: fs.user?.name ?? "Anonymous",
                anonAuthor: true
            };

            this.shader = new Shader( shaderData );
        }

        window.onbeforeunload = ( event ) => {
            event.preventDefault();
            event.returnValue = "";
        };

        var [ leftArea, rightArea ] = this.area.split({ sizes: ["50%", "50%"] });
        rightArea.root.className += " p-2 shader-edit-content";
        leftArea.root.className += " p-2";
        leftArea.onresize = function (bounding) {};

        var [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", null], resize: false });
        codeArea.root.className += " rounded-lg overflow-hidden";

        // Add input channels UI
        {
            this.channelsContainer = LX.makeContainer( ["100%", "100%"], "channel-list grid gap-2 pt-2 items-center justify-center bg-primary", "", shaderSettingsArea );
            for( let i = 0; i < UNIFORM_CHANNELS_COUNT; i++ )
            {
                const channelContainer = LX.makeContainer( ["100%", "100%"], "relative rounded-lg bg-secondary hover:bg-tertiary cursor-pointer overflow-hidden", "", this.channelsContainer );
                channelContainer.style.minHeight = "100px";
                const channelImage = LX.makeElement( "img", "rounded-lg bg-secondary hover:bg-tertiary w-full h-full border-none", "", channelContainer );
                channelImage.src = SRC_IMAGE_EMPTY;
                const channelTitle = LX.makeContainer( ["100%", "auto"], "p-2 absolute text-md bottom-0 channel-title pointer-events-none", `iChannel${ i }`, channelContainer );
                channelContainer.addEventListener( "click", ( e ) => {
                    e.preventDefault();
                    // Open popup with the server textures
                    // ...
                } );
                channelContainer.addEventListener("contextmenu", ( e ) => {
                    e.preventDefault();
                    new LX.DropdownMenu( e.target, [
                        { name: "Remove", className: "fg-error", callback: async () => await this.removeUniformChannel( i ) },
                    ], { side: "top", align: "start" });
                });
            }
        }

        document.title = `${ this.shader.name } - ShaderHub`;

        this.editor = await new LX.CodeEditor( codeArea, {
            allowClosingTabs: false,
            allowLoadingFiles: false,
            fileExplorer: false,
            filesAsync: this.shader.files,
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            onCreateStatusPanel: ( p ) => {
                const customTabInfoButtonsPanel = new LX.Panel( { className: "flex flex-row items-center", height: "auto" } );
                customTabInfoButtonsPanel.addButton( null, "CompileShaderButton", this.compileShader.bind( this ), { icon: "Play", width: "32px", title: "Compile", tooltip: true } );
                p.root.prepend( customTabInfoButtonsPanel.root );
            },
            onCtrlSpace: this.compileShader.bind( this ),
            onSave: this.compileShader.bind( this ),
            onRun: this.compileShader.bind( this ),
            onFilesLoaded: async ( editor, loadedTabs ) => {

                for( const f of this.shader.files )
                {
                    const name = f[ 1 ];
                    this.loadedFiles[ name ] = loadedTabs[ name ].lines.join( "\n" );
                }

                editor.processLines();

                const templateShaderUrl = "shaders/fullscreenTexturedQuad.template.wgsl";
                LX.requestText( templateShaderUrl, async (code) => {

                    this.loadedFiles[ templateShaderUrl ] = code;

                    await this.initGraphics( canvas );
                });
            },
            onCreateFile: ( editor ) => {
                const commonIdx = this.shader.files.length - 1;
                const name = `common${ commonIdx }.wgsl`;

                this.loadedFiles[ name ] = "";
                this.shader.files.splice( -1, 0, [ "", name ] );

                return { name, language: "WGSL", indexOffset: -2 };
            }
        });

        var [ graphicsArea, shaderDataArea ] = leftArea.split({ type: "vertical", sizes: ["70%", null], resize: false });

        // Add Shader data
        {
            shaderDataArea.root.className += " pt-2 items-center justify-center bg-primary";
            const shaderDataContainer = LX.makeContainer( [`100%`, "100%"], "p-6 flex flex-col gap-2 rounded-lg bg-secondary overflow-scroll overflow-x-hidden", "", shaderDataArea );
            const shaderNameAuthorOptionsContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-row", `
                <div class="flex flex-col">
                    <div class="fg-primary text-xxl font-semibold">${ this.shader.name }</div>
                    <div class="fg-primary text-md">by ${ !this.shader.anonAuthor ? "<a class='dodgerblue cursor-pointer hover:text-underline'>" : "" }${ this.shader.author }${ !this.shader.anonAuthor ? "</a>" : "" }</div>
                </div>
            `, shaderDataContainer );

            const hyperlink = shaderNameAuthorOptionsContainer.querySelector( "a" );
            if( hyperlink )
            {
                hyperlink.addEventListener( "click", (e) => {
                    e.preventDefault();
                    this.openProfile( this.shader.authorId )
                } )
            }

            const shaderOptions = LX.makeContainer( [`auto`, "auto"], "ml-auto flex flex-row p-1 gap-1 self-center items-center", ``, shaderNameAuthorOptionsContainer );
            if( fs.user )
            {
                const shaderOptionsButton = new LX.Button( null, "ShaderOptions", async () => {

                    const dmOptions = [ ]

                    if( mode === SHADER_MODE_EDIT )
                    {
                        let result = await this.shaderExists();

                        dmOptions.push( mobile ? 0 : { name: "Save Shader", icon: "Save", callback: this.saveShader.bind( this, result ) } );

                        if( result )
                        {
                            dmOptions.push(
                                mobile ? 0 : { name: "Update Preview", icon: "ImageUp", callback: this.updateShaderPreview.bind( this, this.shader.name, true ) },
                                mobile ? 0 : null,
                                { name: "Delete Shader", icon: "Trash2", className: "fg-error", callback: async () => {} },
                            );
                        }
                    }
                    else
                    {
                        dmOptions.push( mobile ? 0 : { name: "Remix Shader", icon: "GitFork", callback: this.remixShader.bind( this ) } );
                    }

                    new LX.DropdownMenu( shaderOptionsButton.root, dmOptions.filter( o => o !== 0 ), { side: "bottom", align: "end" });
                }, { icon: "Menu" } );
                shaderOptions.appendChild( shaderOptionsButton.root );
            }
            else
            {
                LX.makeContainer( [`auto`, "auto"], "fg-secondary text-md", "Login to save your shader", shaderOptions );
            }
            // const shaderDate = LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg", this.shader.lastUpdatedDate, shaderDataContainer );

            const ownProfile = ( this.shader.authorId === fs.getUserId() );
            if( ownProfile )
            {
                const textArea = new LX.TextArea( null, this.shader.description, (v) => this.shader.description = v, { resize: false, className: "h-full", inputClass: "bg-tertiary h-full" } );
                shaderDataContainer.appendChild( textArea.root );
            }
            else
            {
                // Non editable description
                LX.makeContainer( [`auto`, "auto"], "fg-primary mt-4 text-lg break-words", this.shader.description, shaderDataContainer );
            }
        }

        var [ canvasArea, canvasControlsArea ] = graphicsArea.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });

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

        // Add shader controls data
        {
            canvasControlsArea.root.className += " px-2 rounded-b-lg bg-secondary";
            const panel = canvasControlsArea.addPanel( { className: "flex flex-row" } );
            panel.sameLine();
            panel.addButton( null, "ResetTime", this.resetShaderElapsedTime.bind( this ), { icon: "SkipBack", title: "Reset time", tooltip: true } );
            panel.addButton( null, "PauseTime", () => { this.timePaused = !this.timePaused }, { icon: "Pause", title: "Pause/Resume", tooltip: true, swap: "Play" } );
            panel.addLabel( "0.0", { signal: "@elapsed-time", xclassName: "ml-auto", xinputClass: "text-end" } );
            panel.endLine( "items-center h-full" );

            // Mobile version cannot open uniforms box
            if( mobile )
            {
                return;
            }

            const customParametersContainer = LX.makeContainer(
                ["auto", "auto"],
                "overflow-scroll",
                "",
                null,
                { maxHeight: "256px", maxWidth: `${ window.innerWidth - 64 }px` }
            );

            const uniformsHeader = LX.makeContainer( ["auto", "auto"], "flex flex-row p-2 items-center", "", customParametersContainer );
            const uniformsCountTitle = LX.makeContainer( ["auto", "auto"], "", `Uniforms [${ this.shader.uniforms.length }]`, uniformsHeader );
            const addUniformButton = new LX.Button( null, "AddNewCustomUniform", () => {
                this.addUniform();
                this.customParametersPanel.refresh();
            }, { icon: "Plus", className: "ml-auto self-center", buttonClass: "bg-none", title: "Add New Uniform", tooltip: true, width: "38px" } );
            uniformsHeader.appendChild( addUniformButton.root );

            // Popover to dialog button
            {
                const dialogizePopoverButton = new LX.Button( null,
                    "DialogizePopoverButton",
                    this.openUniformsDialog.bind( this ),
                    { icon: "AppWindowMac", className: "self-center", buttonClass: "bg-none", title: "Expand Window", tooltip: true, width: "38px" } );
                uniformsHeader.appendChild( dialogizePopoverButton.root );
            }

            // Create the content for the uniforms panel
            {
                this.customParametersPanel = new LX.Panel({ className: "custom-parameters-panel w-full" });
                customParametersContainer.appendChild( this.customParametersPanel.root );

                this.customParametersPanel.refresh = ( overridePanel, onRefresh ) => {

                    overridePanel = overridePanel ?? this.customParametersPanel;

                    overridePanel.clear();

                    overridePanel.addLabel( "Uniform names must start with i + Capital letter (e.g. iTime)." );

                    for( let u of this.shader.uniforms )
                    {
                        overridePanel.sameLine( 5 );
                        overridePanel.addText( null, u.name, ( v ) => {
                            u.name = v;
                            this.createRenderPipeline( true, true );
                        }, { width: "25%", skipReset: true, pattern: "\\b(?!(" + DEFAULT_UNIFORM_NAMES.join("|") + ")\\b)(i[A-Z]\\w*)\\b" } );
                        overridePanel.addNumber( "Min", u.min, ( v ) => {
                            u.min = v;
                            uRangeComponent.setLimits( u.min, u.max );
                            this._parametersDirty = true;
                        }, { nameWidth: "40%", width: "17%", skipReset: true, step: 0.1 } );
                        const uRangeComponent = overridePanel.addRange( null, u.value, ( v ) => {
                            u.value = v;
                            this._parametersDirty = true;
                        }, { className: "contrast", width: "35%", skipReset: true, min: u.min, max: u.max, step: 0.1 } );
                        overridePanel.addNumber( "Max", u.max, ( v ) => {
                            u.max = v;
                            uRangeComponent.setLimits( u.min, u.max );
                            this._parametersDirty = true;
                        }, { nameWidth: "40%", width: "17%", skipReset: true, step: 0.1 } );
                        overridePanel.addButton( null, "RemoveUniformButton", ( v ) => {
                            // Check if the uniforms is used to recompile shaders or not
                            const allCode = this.getShaderCode( false );
                            const idx = this.shader.uniforms.indexOf( u );
                            this.shader.uniforms.splice( idx, 1 );
                            this.customParametersPanel.refresh( overridePanel );
                            if( allCode.match( new RegExp( `\\b${ u.name }\\b` ) ) )
                            {
                                this.createRenderPipeline( true, true );
                            }
                        }, { width: "6%", icon: "X", buttonClass: "bg-none", title: "Remove Uniform", tooltip: true } );
                    }

                    // Updates probably to the panel at the dialog
                    if( onRefresh )
                    {
                        onRefresh();
                    }
                    else
                    {
                        // Updates to the popover
                        uniformsCountTitle.innerHTML = `Uniforms [${ this.shader.uniforms.length }]`;

                        if( LX.Popover.activeElement )
                        {
                            LX.Popover.activeElement._adjustPosition();
                        }
                    }
                }

                this.customParametersPanel.refresh();
            }

            panel.sameLine();

            panel.addButton( null, "OpenCustomParams", ( name, event ) => {

                if( this._lastUniformsDialog )
                {
                    this._lastUniformsDialog.close();
                }

                // Refresh content first
                this.customParametersPanel.refresh();

                new LX.Popover( event.target, [ customParametersContainer ], { align: "end" } );

            }, { icon: "Settings2", title: "Custom Parameters", tooltip: true } );

            panel.endLine( "items-center h-full ml-auto" );
        }
    },

    openProfile( userID ) {
        window.location.href = `${ window.location.origin + window.location.pathname }?profile=${ userID }`;
    },

    openLoginDialog() {

        const dialog = new LX.Dialog( "Login", ( p ) => {
            const formData = { email: { label: "Email", value: "", icon: "AtSign" }, password: { label: "Password", icon: "Key", value: "", type: "password" } };
            const form = p.addForm( null, formData, async (value, event) => {
                await fs.login( value.email, value.password, ( user, session ) => {
                    dialog.close();
                    const loginButton = document.getElementById( "loginOptionsButton" );
                    if( loginButton )
                    {
                        loginButton.innerHTML = `<span class="decoration-none fg-secondary">${ fs.user.email }</span>
                                                    ${ LX.makeIcon("ChevronsUpDown", { iconClass: "pl-2" } ).innerHTML }`;
                    }
                    const signupContainer = document.getElementById( "signupContainer" );
                    if( signupContainer )
                    {
                        signupContainer.classList.add( "hidden" );
                    }
                    document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
                    LX.toast( `✅ Logged in`, `User: ${ value.email }`, { position: "top-right" } );
                }, (err) => {
                    LX.toast( `❌ Error`, err, { timeout: -1, position: "top-right" } );
                } );
            }, { primaryActionName: "Login" });
            form.root.querySelector( "button" ).classList.add( "mt-2" );
        }, { modal: true } );
    },

    openSignUpDialog() {

        const dialog = new LX.Dialog( "Create account", ( p ) => {

            const namePattern = LX.buildTextPattern( { minLength: USERNAME_MIN_LENGTH } );
            const passwordPattern = LX.buildTextPattern( { minLength: PASSWORD_MIN_LENGTH, digit: true } );
            const formData = {
                name: { label: "Name", value: "", icon: "User", xpattern: namePattern },
                email: { label: "Email", value: "", icon: "AtSign" },
                password: { label: "Password", value: "", type: "password", icon: "Key", xpattern: passwordPattern },
                confirmPassword: { label: "Confirm password", value: "", type: "password", icon: "Key" }
            };
            const form = p.addForm( null, formData, async (value, event) => {

                errorMsg.set( "" );

                if( !( value.name.match( new RegExp( namePattern ) ) ) )
                {
                    errorMsg.set( `❌ Name is too short. Please use at least ${ USERNAME_MIN_LENGTH } characters.` );
                    return;
                }
                else if( !( value.email.match( /^[^\s@]+@[^\s@]+\.[^\s@]+$/ ) ) )
                {
                    errorMsg.set( "❌ Please enter a valid email address." );
                    return;
                }
                else if( value.password.length < PASSWORD_MIN_LENGTH )
                {
                    errorMsg.set( `❌ Password is too short. Please use at least ${ PASSWORD_MIN_LENGTH } characters.` );
                    return;
                }
                else if( !( value.password.match( new RegExp( passwordPattern ) ) ) )
                {
                    errorMsg.set( `❌ Password must contain at least 1 digit.` );
                    return;
                }
                else if( value.password !== value.confirmPassword )
                {
                    errorMsg.set( "❌ The password and confirmation fields must match." );
                    return;
                }

                await fs.createAccount( value.email, value.password, value.name, async ( user ) => {
                    dialog.close();
                    document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
                    LX.toast( `✅ Account created!`, `You can now login with your email: ${ value.email }`, { position: "top-right" } );

                    // Update DB
                    {
                        const result = await fs.createDocument( FS.USERS_COLLECTION_ID, {
                            "user_id": user[ "$id" ],
                            "user_name": value.name
                        } );
                    }

                    this.openLoginDialog();
                }, (err) => {
                    errorMsg.set( `❌ ${ err }` );
                } );
            }, { primaryActionName: "SignUp" });
            form.root.querySelector( "button" ).classList.add( "mt-2" );
            const errorMsg = p.addTextArea( null, "", null, { inputClass: "fg-secondary", disabled: true, fitHeight: true } );
        }, { modal: true } );
    },

    openUniformsDialog() {

        if( this._lastUniformsDialog )
        {
            this._lastUniformsDialog.close();
        }

        const dialog = new LX.Dialog( `Uniforms [${ this.shader.uniforms.length }]`, null, {
            modal: false, draggable: true, size: [ Math.min( 600, window.innerWidth - 64 ), "auto" ]
        } );

        // Put all the stuff in the dialog panel
        this.customParametersPanel.refresh( dialog.panel );

        const uniformsHeader = LX.makeContainer( ["auto", "auto"], "flex flex-row items-center", "", dialog.title );
        const addUniformButton = new LX.Button( null, "AddNewCustomUniform", () => {
            this.addUniform();
            this.customParametersPanel.refresh( dialog.panel, () => dialog.title.childNodes[ 0 ].textContent = `Uniforms [${ this.shader.uniforms.length }]` );
        }, { icon: "Plus", className: "ml-auto self-center", buttonClass: "bg-none", title: "Add New Uniform", width: "38px" } );
        uniformsHeader.appendChild( addUniformButton.root );
        LX.makeContainer( [`auto`, "0.75rem"], "ml-2 mr-4 border-right border-colored fg-quaternary self-center items-center", "", uniformsHeader );
        const closerButton = dialog.title.querySelector( "a" );
        uniformsHeader.appendChild( closerButton );
        // Re-add listener since it lost it changing the parent
        closerButton.addEventListener( "click", dialog.close );

        this._lastUniformsDialog = dialog;
    },

    createNewShader() {
        // Only crete a new shader view, nothing to save now
        window.location.href = `${ window.location.origin + window.location.pathname }?edit=new`;
    },

    async saveShader( existingShader ) {

        if( !fs.user )
        {
            console.warn( "Login to save your shader!" );
            return;
        }

        if( existingShader )
        {
            this.overrideShader( existingShader );
            return;
        }

        const dialog = new LX.Dialog( "New Shader", ( p ) => {
            let shaderName = "";
            const textInput = p.addText( "Name", shaderName, ( v ) => {
                shaderName = v;
            }, { pattern: LX.buildTextPattern( { minLength: 3 } ) } );
            p.addSeparator();
            p.addButton( null, "ConfirmSaveButton", async () => {
                if( !shaderName.length || !textInput.valid( shaderName ) )
                {
                    return;
                }

                // Upload document and get id
                const filename = "main.wgsl";
                const code = this.loadedFiles[ filename ].replaceAll( '\r', '' );
                const arraybuffer = new TextEncoder().encode( code );
                const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
                let result = await fs.createFile( file );
                const fileId = result[ "$id" ];

                // Create a new shader in the DB
                result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
                    "name": shaderName,
                    "author_id": fs.getUserId(),
                    "file_id": fileId,
                    "description": this.shader.description,
                    "uniforms": JSON.stringify( this.shader.uniforms )
                } );

                // Upload canvas snapshot
                this.updateShaderPreview( shaderName, false );

                this.shader.uid = result[ "$id" ];
                this.shader.name = shaderName;

                // Close dialog on succeed and show toast
                dialog.close();
                LX.toast( `✅ Shader saved`, `Shader: ${ shaderName } by ${ fs.user.name }`, { position: "top-right" } );
            }, {  } );
        } );
    },

    async overrideShader( shaderMetadata ) {

        // Delete old files first
        const fileIdString = shaderMetadata[ "file_id" ];
        const fileIds = fileIdString.split( "," );
        for( const fid of fileIds )
        {
            await fs.deleteFile( fid );
        }

        let newFileId = "";

        // Create new COMMON files with the current code
        for( let i = 0; i < this.shader.files.length - 1; ++i )
        {
            const filename = `common${ i }.wgsl`;
            const code = this.loadedFiles[ filename ].replaceAll( '\r', '' );
            const arraybuffer = new TextEncoder().encode( code );
            const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
            let result = await fs.createFile( file );
            newFileId += `${ result[ "$id" ] },`;
        }

        // Create new MAIN files with the current code
        {
            const filename = "main.wgsl";
            const code = this.loadedFiles[ filename ].replaceAll( '\r', '' );
            const arraybuffer = new TextEncoder().encode( code );
            const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
            let result = await fs.createFile( file );
            newFileId += result[ "$id" ];
        }

        // Update files reference in the DB
        {
            await fs.updateDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid, {
                "file_id": newFileId,
                "description": this.shader.description,
                "uniforms": JSON.stringify( this.shader.uniforms )
            } );
        }

        // Update canvas snapshot
        this.updateShaderPreview( this.shader.name, false );

        LX.toast( `✅ Shader updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );
    },

    async updateShaderPreview( shaderName, showFeedback = true ) {
        // Delete old preview first if necessary
        const previewName = `${ shaderName.replaceAll( " ", "_" ) }_preview.png`;
        const result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
        if( result.total > 0 )
        {
            const fileId = result.files[ 0 ][ "$id" ];
            await fs.deleteFile( fileId );
        }

        // Create new one
        const blob = await this.snapshotCanvas();
        const file = new File( [ blob ], previewName, { type: "image/png" });
        await fs.createFile( file );

        if( showFeedback )
        {
            LX.toast( `✅ Shader preview updated`, `Shader: ${ shaderName } by ${ fs.user.name }`, { position: "top-right" } );
        }
    },

    async remixShader() {

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
            this.timeBuffer = this.device.createBuffer({
                size: 4,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });

            this.frameCountBuffer = this.device.createBuffer({
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
                this.device.queue.writeBuffer(
                    this.timeBuffer,
                    0,
                    new Float32Array([ this.elapsedTime ])
                );

                this.elapsedTime += ( dt / 1000 );

                this.device.queue.writeBuffer(
                    this.frameCountBuffer,
                    0,
                    new Int32Array([ this.frameCount ])
                );

                this.frameCount++;

                LX.emit( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
            }

            if( this._parametersDirty && this.shader.uniforms.length )
            {
                this.shader.uniforms.map( ( u, index ) => {
                    this.device.queue.writeBuffer(
                        this.shader.uniformBuffers[ index ],
                        0,
                        new Float32Array([ u.value ])
                    );
                } );

                this._parametersDirty = false;
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

    getShaderCode( includeBindings = true ) {

        const templateCodeLines = this.loadedFiles[ "shaders/fullscreenTexturedQuad.template.wgsl" ].replaceAll( '\r', '' ).split( "\n" );

        if( includeBindings )
        {
            let bindingIndex = 0;

            // Default Uniform bindings
            {
                const defaultBindingsIndex = templateCodeLines.indexOf( "$default_bindings" );
                console.assert( defaultBindingsIndex > -1 );
                templateCodeLines.splice( defaultBindingsIndex, 1, ...DEFAULT_UNIFORMS_LIST.map( ( u, index ) => {
                    return `@group(0) @binding(${ bindingIndex++ }) var<uniform> ${ u.name } : ${ u.type };`;
                } ).filter( u => u !== undefined ) );
            }

            // Custom Uniform bindings
            {
                for( let u of this.shader.uniforms )
                {
                    this.shader.uniformBuffers.push( this.device.createBuffer({
                        size: 4,
                        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
                    }) );
                }

                const customBindingsIndex = templateCodeLines.indexOf( "$custom_bindings" );
                console.assert( customBindingsIndex > -1 );
                templateCodeLines.splice( customBindingsIndex, 1, ...this.shader.uniforms.map( ( u, index ) => {
                    if( !u ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var<uniform> ${ u.name } : f32;`;
                } ).filter( u => u !== undefined ) );
            }

            // Process texture bindings
            {
                const textureBindingsIndex = templateCodeLines.indexOf( "$texture_bindings" );
                console.assert( textureBindingsIndex > -1 );
                const bindings = this.uniformChannels.map( ( u, index ) => {
                    if( !u ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var iChannel${ index } : texture_2d<f32>;`;
                } );
                templateCodeLines.splice( textureBindingsIndex, 1, ...(bindings.length ? [ ...bindings.filter( u => u !== undefined ), `@group(0) @binding(${ bindingIndex++ }) var texSampler : sampler;` ] : []) );
            }

            // Process dummies so using them isn't mandatory
            {
                const defaultDummiesIndex = templateCodeLines.indexOf( "$default_dummies" );
                console.assert( defaultDummiesIndex > -1 );
                templateCodeLines.splice( defaultDummiesIndex, 1, ...DEFAULT_UNIFORMS_LIST.map( ( u, index ) => {
                    if( !u ) return;
                    return `    let u${ u.name }Dummy: ${ u.type } = ${ u.name };`;
                } ).filter( u => u !== undefined ) );

                const customDummiesIndex = templateCodeLines.indexOf( "$custom_dummies" );
                console.assert( customDummiesIndex > -1 );
                templateCodeLines.splice( customDummiesIndex, 1, ...this.shader.uniforms.map( ( u, index ) => {
                    if( !u ) return;
                    return `    let u${ u.name }Dummy: f32 = ${ u.name };`;
                } ).filter( u => u !== undefined ) );

                const textureDummiesIndex = templateCodeLines.indexOf( "$texture_dummies" );
                console.assert( textureDummiesIndex > -1 );
                templateCodeLines.splice( textureDummiesIndex, 1, ...this.uniformChannels.map( ( u, index ) => {
                    if( !u ) return;
                    return `    let channel${ index }Dummy: vec4f = textureSample(iChannel${ index }, texSampler, fragUV);`;
                } ).filter( u => u !== undefined ) );
            }
        }

        // Add common blocks
        {
            let allCommon = [];

            for( let i = 0; i < this.shader.files.length - 1; ++i )
            {
                const name = `common${ i }.wgsl`;
                const code = this.loadedFiles[ name ];
                if( code )
                {
                    allCommon = allCommon.concat( code.replaceAll( '\r', '' ).split( "\n" ) );
                }
            }

            const commonIndex = templateCodeLines.indexOf( "$common" );
            console.assert( commonIndex > -1 );
            templateCodeLines.splice( commonIndex, 1, ...allCommon );
        }

        // Add main image
        {
            const mainImageIndex = templateCodeLines.indexOf( "$main_image" );
            console.assert( mainImageIndex > -1 );
            const mainName = this.shader.files.at( -1 )[ 1 ]; // First Name of the last file
            const mainImageLines = this.loadedFiles[ mainName ].replaceAll( '\r', '' ).split( "\n" );
            templateCodeLines.splice( mainImageIndex, 1, ...mainImageLines );
        }

        return templateCodeLines.join( "\n" );
    },

    async createRenderPipeline( updateBindGroup = true, showFeedback ) {

        const result = await this.validateShader( this.getShaderCode(), showFeedback );
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

        console.warn( "Info: Render Pipeline created!" );

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

        let bindingIndex = 0;

        const entries = [
            {
                binding: bindingIndex++,
                resource: {
                    buffer: this.timeBuffer,
                }
            },
            {
                binding: bindingIndex++,
                resource: {
                    buffer: this.frameCountBuffer,
                }
            },
            {
                binding: bindingIndex++,
                resource: {
                    buffer: this.resolutionBuffer,
                }
            }
        ]

        const customUniformCount = this.shader.uniforms.length;
        if( customUniformCount )
        {
            this.shader.uniforms.map( ( u, index ) => {
                const buffer = this.shader.uniformBuffers[ index ];
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

        const bindings = this.uniformChannels.filter( u => u !== undefined );

        if( bindings.length )
        {
            entries.push( ...this.uniformChannels.map( ( u, index ) => {
                if( !u ) return;
                return { binding: bindingIndex++, resource: u.createView() };
            } ).filter( u => u !== undefined ) );
            entries.push( { binding: bindingIndex++, resource: this.sampler } );
        }

        this.renderBindGroup = this.device.createBindGroup({
            layout: this.fullscreenQuadPipeline.getBindGroupLayout( 0 ),
            entries
        });

        console.warn( "Info: Render Bind Group created!" );
    },

    async createTexture( fileId, channel ) {

        const url = await fs.getFileUrl( fileId );
        const data = await fs.requestFile( url );
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
            { source: imageBitmap, flipY: true },
            { texture: imageTexture },
            dimensions
        );

        const metadata = await fs.getFile( fileId );
        this.loadedImages[ metadata.name ] = imageTexture;

        if( channel !== undefined )
        {
            this.uniformChannels[ channel ] = imageTexture;
            this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = url;
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
            const currentTab = this.editor.getSelectedTabName();
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

    async compileShader() {

        this.editor.processLines();

        for( const tabName of Object.keys( this.editor.tabs.tabs ) )
        {
            const code = this.editor.tabs.tabs[ tabName ].lines.join( '\n' );
            this.loadedFiles[ tabName ] = code;
        }

        await this.createRenderPipeline( true, true );
    },

    async shaderExists() {
        try {
            return await fs.getDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid );
        } catch (error) {
            // Doesn't exist...
        }
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

    addUniform( name, value, min, max ) {

        const uName = name ?? `iUniform${ this.shader.uniforms.length + 1 }`;
        this.shader.uniforms.push( { name: uName, value: value ?? 0, min: min ?? 0, max: max ?? 1 } );
        const allCode = this.getShaderCode( false );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            this.createRenderPipeline( true, true );
        }
    },

    resetShaderElapsedTime() {

        this.frameCount = 0;
        this.elapsedTime = 0;

        this.device.queue.writeBuffer(
            this.timeBuffer,
            0,
            new Float32Array([ this.elapsedTime ])
        );

        this.device.queue.writeBuffer(
            this.frameCountBuffer,
            0,
            new Int32Array([ this.frameCount ])
        );

        LX.emit( "@elapsed-time", `${ this.elapsedTime.toFixed( 2 ) }s` );
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
    }
}

await ShaderHub.initUI();

window.LX = LX;
window.ShaderHub = ShaderHub;
window.fs = fs;
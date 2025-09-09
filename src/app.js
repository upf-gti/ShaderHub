import { LX } from 'lexgui';
// import 'lexgui/extensions/codeeditor.js';
import './extra/codeeditor.js';
import { FS } from './fs.js';
import { Shader } from './shader.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const USERNAME_MIN_LENGTH = 3;
const PASSWORD_MIN_LENGTH = 8;

const UNIFORM_CHANNELS_COUNT = 4;
const DEFAULT_UNIFORMS_LIST = [
    { name: "iTime", type: "f32", info: "Shader playback time (s)" },
    { name: "iTimeDelta", type: "f32", info: "Render time (s)" },
    { name: "iFrame", type: "i32", info: "Shader playback frame" },
    { name: "iResolution", type: "vec2f", info: "Viewport resolution (px)" },
    { name: "iMouse", type: "vec4f", info: "Mouse data" },
    { name: "iChannel0..3", type: "texture_2d<f32>", info: "Texture input channel", skipBindings: true }
];
const DEFAULT_UNIFORM_NAMES = DEFAULT_UNIFORMS_LIST.map( u => u.name );

const SRC_IMAGE_EMPTY = "data:image/gif;base64,R0lGODlhAQABAPcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACH5BAEAAP8ALAAAAAABAAEAAAgEAP8FBAA7";

const fs = new FS();
const Query = Appwrite.Query;
const mobile = navigator && /Android|iPhone/i.test( navigator.userAgent );

function capitalizeFirstLetter(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

function toESDate( date ) {
    const ts = date.substring( 0, 10 ).split("-");
    return [ ts[ 2 ], ts[ 1 ], ts[ 0 ] ].join("-");
}

function getDate() {
    const date = new Date();
    const day = `${ date.getDate() }`;
    const month = `${ date.getMonth() + 1 }`;
    const year = `${ date.getFullYear() }`;
    return `${ "0".repeat( 2 - day.length ) }${ day }-${ "0".repeat( 2 - month.length ) }${ month }-${ year }`;
}

const CODE2ASCII = {};

for (let i = 0; i < 26; i++) CODE2ASCII["Key" + String.fromCharCode(65 + i)] = 65 + i;  // Letters A–Z → ASCII uppercase
for (let i = 0; i < 10; i++) CODE2ASCII["Digit" + i] = 48 + i;                          // Digits 0–9 → ASCII '0'–'9'
for (let i = 0; i < 10; i++) CODE2ASCII["Numpad" + i] = 48 + i;                         // Numpad digits. same as ASCII '0'–'9'
for (let i = 1; i <= 12; i++) CODE2ASCII["F" + i] = 111 + i;                            // Function keys → assign numbers starting from 112 (legacy F1..F12 codes)

// Common symbols (matching US layout ASCII)
Object.assign(CODE2ASCII, { "Space": 32, "Enter": 13, "Tab": 9, "Backspace": 8, "Escape": 27, "Minus": 45, "Equal": 61, "BracketLeft": 91, "BracketRight": 93, "Backslash": 92, "Semicolon": 59, "Quote": 39, "Backquote": 96, "Comma": 44, "Period": 46, "Slash": 47 });
// Arrows and controls (matching old keyCodes)
Object.assign(CODE2ASCII, { "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40, "Insert": 45, "Delete": 46, "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34 });

const ShaderHub = {

    shaderList: [],
    loadedFiles: {},
    loadedImages: {},
    uniformChannels: [],

    keyState: new Map(),
    keyToggleState: new Map(),
    keyPressed: new Map(),
    mousePosition: [ 0, 0 ],
    lastMousePosition: [ 0, 0 ],

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
                ${ fs.user ? `<span class="decoration-none fg-secondary">${ fs.user.email }</span>
                    <span class="ml-1 rounded-full w-6 h-6 bg-accent text-center leading-tight content-center">${ fs.user.name[ 0 ].toUpperCase() }</span>
                    ${ LX.makeIcon("ChevronsUpDown", { iconClass: "pl-2" } ).innerHTML }` : "Login" }`, menubar.root );
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
                            document.getElementById( "signupContainer" )?.classList.remove( "hidden" );
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
            const queryShader = params.get( "shader" );
            const queryProfile = params.get( "profile" );
            if( queryShader )
            {
                await this.createShaderView( queryShader );
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
                uid: document[ "$id" ],
                creationDate: toESDate( document[ "$createdAt" ] )
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

            const previewName = `${ shaderInfo.uid }.png`;
            const result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
            if( result.total > 0 )
            {
                shaderInfo.preview = await fs.getFileUrl( result.files[ 0 ][ "$id" ] );
            }

            this.shaderList.push( shaderInfo );
        }

        this.shaderList = this.shaderList.sort( (a, b) => a.name.localeCompare( b.name ) );

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
                    <div class="text-lg font-bold">${ shader.name }</div>
                    <div class="text-sm font-light">by ${ !shader.anonAuthor ? "<a class='dodgerblue cursor-pointer hover:text-underline'>" : "" }<span class="font-bold">${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" }</div>
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
                window.location.href = `${ window.location.origin + window.location.pathname }?shader=${ shader.uid }`;
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
           <div class="text-xxl font-bold">${ userName }</span>
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

            const previewName = `${ shaderInfo.uid }.png`;
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
                    <div class="text-lg font-bold"><span>${ shaderInfo.name }</span></div>
                </div>
                <div class="">
                    <div class="">
                        ${ LX.makeIcon( "CircleUserRound", { svgClass: "xxl fg-secondary" } ).innerHTML }
                    </div>
                </div>`, shaderItem );
                // <img alt="avatar" width="32" height="32" decoding="async" data-nimg="1" class="rounded-full" src="https://imgproxy.compute.toys/insecure/width:64/plain/https://hkisrufjmjfdgyqbbcwa.supabase.co/storage/v1/object/public/avatar/f91bbd73-7734-49a9-99ce-460774d4ccc0/avatar.jpg">

            shaderPreview.addEventListener( "click", ( e ) => {
                window.location.href = `${ window.location.origin + window.location.pathname }?shader=${ shaderInfo.uid }`;
            } );
        }

        if( listContainer.childElementCount === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
        }
    },

    async createShaderView( shaderUid ) {

        const isNewShader = ( shaderUid === "new" );

        // Create shader instance based on shader uid
        // Get all stored shader files (not the code, only the data)
        if( !isNewShader )
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
                description: result.description ?? "",
                creationDate: toESDate( result[ "$createdAt" ] )
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
                anonAuthor: true,
                creationDate: getDate()
            };

            this.shader = new Shader( shaderData );
        }

        window.onbeforeunload = ( event ) => {
            event.preventDefault();
            event.returnValue = "";
        };

        let [ leftArea, rightArea ] = this.area.split({ sizes: ["50%", "50%"] });
        rightArea.root.className += " p-2 shader-edit-content";
        leftArea.root.className += " p-2";
        leftArea.onresize = function (bounding) {};

        let [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", null], resize: false });
        codeArea.root.className += " rounded-lg overflow-hidden";

        // Add input channels UI
        {
            this.channelsContainer = LX.makeContainer( ["100%", "100%"], "channel-list grid gap-2 pt-2 items-center justify-center bg-primary", "", shaderSettingsArea );
            for( let i = 0; i < UNIFORM_CHANNELS_COUNT; i++ )
            {
                const channelContainer = LX.makeContainer( ["100%", "100%"], "relative text-center content-center rounded-lg bg-secondary hover:bg-tertiary cursor-pointer overflow-hidden", "", this.channelsContainer );
                channelContainer.style.minHeight = "100px";
                const channelImage = LX.makeElement( "img", "rounded-lg bg-secondary hover:bg-tertiary border-none", "", channelContainer );
                channelImage.src = SRC_IMAGE_EMPTY;
                channelImage.style.width = "95%";
                channelImage.style.height = "95%";
                const channelTitle = LX.makeContainer( ["100%", "auto"], "p-2 absolute text-md bottom-0 channel-title pointer-events-none", `iChannel${ i }`, channelContainer );
                channelContainer.addEventListener( "click", ( e ) => {
                    e.preventDefault();
                    this.openAvailableChannels( i );
                } );
                channelContainer.addEventListener("contextmenu", ( e ) => {
                    e.preventDefault();
                    new LX.DropdownMenu( e.target, [
                        { name: "Remove", className: "fg-error", callback: async () => await this.removeUniformChannel( i ) },
                    ], { side: "top", align: "start" });
                });
            }
        }

        document.title = `${ this.shader.name } (${ this.shader.author }) - ShaderHub`;

        this.editor = await new LX.CodeEditor( codeArea, {
            allowClosingTabs: false,
            allowLoadingFiles: false,
            fileExplorer: false,
            filesAsync: this.shader.files,
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            onCreateStatusPanel: this.createStatusBarButtons.bind( this ),
            onCtrlSpace: this.compileShader.bind( this ),
            onSave: this.compileShader.bind( this ),
            onRun: this.compileShader.bind( this ),
            onFilesLoaded: async ( editor, loadedTabs ) => {

                for( const f of this.shader.files )
                {
                    const name = f[ 1 ];
                    this.loadedFiles[ name ] = loadedTabs[ name ].lines.join( "\n" );
                    // Delete lang icon and add close icon
                    if( name !== "main.wgsl" )
                    {
                        const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
                        LX.asTooltip( closeIcon, "Delete file" );
                        closeIcon.addEventListener( "click", (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            this.shader.files.splice( this.shader.files.indexOf( f ), 1 );
                            editor.tabs.delete( name );
                            document.body.querySelectorAll( ".lextooltip" ).forEach( e => e.remove() );
                            delete this.loadedFiles[ name ];
                        } );
                        editor.tabs.tabDOMs[ name ].appendChild( closeIcon );
                    }
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
                const file = [ "", name ];

                this.loadedFiles[ name ] = "";
                this.shader.files.splice( -1, 0, file );

                // Wait for the tab to be created
                LX.doAsync( () => {
                    const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
                    LX.asTooltip( closeIcon, "Delete file" );
                    closeIcon.addEventListener( "click", (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.shader.files.splice( this.shader.files.indexOf( file ), 1 );
                        editor.tabs.delete( name );
                        document.body.querySelectorAll( ".lextooltip" ).forEach( e => e.remove() );
                        delete this.loadedFiles[ name ];
                    } );
                    editor.tabs.tabDOMs[ name ].appendChild( closeIcon );
                }, 10 );

                return { name, language: "WGSL", indexOffset: -2 };
            },
            onContextMenu: ( editor, content, event ) => {

                const word = content.trim().match( /([A-Za-z0-9_]+)/g )[ 0 ];
                if( !word )
                {
                    return;
                }

                const options = [];
                const USED_UNIFORM_NAMES = [ ...DEFAULT_UNIFORM_NAMES, ...this.shader.uniforms.map( u => u.name ) ];
                const regex = new RegExp( "\\b(?!(" + USED_UNIFORM_NAMES.join("|") + ")\\b)(i[A-Z]\\w*)\\b" );
                
                options.push( { path: "Create Uniform", disabled: !regex.test( word ), callback: async () => {
                    await this.addUniform( word );
                    await this.compileShader();
                    this.openCustomUniforms();
                } } );

                return options;
            }
        });

        var [ graphicsArea, shaderDataArea ] = leftArea.split({ type: "vertical", sizes: ["70%", null], resize: false });

        const ownProfile = fs.user && ( this.shader.authorId === fs.getUserId() );

        // Add Shader data
        {
            shaderDataArea.root.className += " pt-2 items-center justify-center bg-primary";
            const shaderDataContainer = LX.makeContainer( [`100%`, "100%"], "p-6 flex flex-col gap-2 rounded-lg bg-secondary overflow-scroll overflow-x-hidden", "", shaderDataArea );
            const shaderNameAuthorOptionsContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-row", `
                <div class="flex flex-col">
                    <div class="flex flex-row items-center">
                        ${ ( ownProfile || isNewShader ) ? LX.makeIcon("Edit", { svgClass: "mr-2 cursor-pointer hover:fg-primary" } ).innerHTML : "" }
                        <div class="fg-primary text-xxl font-semibold">${ this.shader.name }</div>
                    </div>
                    <div class="fg-secondary text-md">created by ${ !this.shader.anonAuthor ? "<a class='dodgerblue cursor-pointer hover:text-underline'>" : "" }${ this.shader.author }${ !this.shader.anonAuthor ? "</a>" : "" }
                    on <span class="font-bold">${ this.shader.creationDate }</span></div>
                </div>
            `, shaderDataContainer );

            const editButton = shaderNameAuthorOptionsContainer.querySelector( "svg" );
            if( editButton )
            {
                editButton.addEventListener( "click", (e) => {
                    if( this._editingName ) return;
                    e.preventDefault();
                    const text = e.target.parentElement.children[ 1 ]; // get non-editable text
                    const input = new LX.TextInput( null, text.textContent, async (v) => {
                        text.innerText = v;
                        input.root.replaceWith( text );
                        await this.updateShaderName( v );
                        this._editingName = false;
                    }, { inputClass: "fg-primary text-xxl font-semibold", pattern: LX.buildTextPattern( { minLength: 3 } ) } );
                    text.replaceWith( input.root );
                    LX.doAsync( () => input.root.focus() );
                    this._editingName = true;
                } )
            }

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

                    if( ownProfile || isNewShader )
                    {
                        let result = await this.shaderExists();

                        dmOptions.push( mobile ? 0 : { name: "Save Shader", icon: "Save", callback: this.saveShader.bind( this, result ) } );

                        if( result )
                        {
                            dmOptions.push(
                                mobile ? 0 : { name: "Update Preview", icon: "ImageUp", callback: this.updateShaderPreview.bind( this, this.shader.uid, true ) },
                                mobile ? 0 : null,
                                { name: "Delete Shader", icon: "Trash2", className: "fg-error", callback: this.deleteShader.bind( this ) },
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
                LX.makeContainer( [`auto`, "auto"], "fg-secondary text-md", "Login to save/remix this shader", shaderOptions );
            }

            // Editable description
            {
                const descContainer = LX.makeContainer( [`auto`, "auto"], "fg-primary mt-2 flex flex-row items-center", `
                    <div class="w-auto">${ ( ownProfile || ( shaderUid === "new" ) ) ? LX.makeIcon("Edit", { svgClass: "mr-3 cursor-pointer hover:fg-primary" } ).innerHTML : "" }</div>
                    <div class="desc-content w-full text-md break-words">${ this.shader.description }</div>
                    `, shaderDataContainer );

                const editButton = descContainer.querySelector( "svg" );
                if( editButton )
                {
                    editButton.addEventListener( "click", (e) => {
                        if( this._editingDescription ) return;
                        e.preventDefault();
                        const text = descContainer.querySelector( ".desc-content" );
                        const input = new LX.TextArea( null, text.innerHTML, async (v) => {
                            text.innerHTML = v;
                            input.root.replaceWith( text );
                            this.shader.description = v;
                            this._editingDescription = false;
                        }, { width: "100%", resize: false, className: "h-full", inputClass: "bg-tertiary h-full" , fitHeight: true } );
                        text.replaceWith( input.root );
                        LX.doAsync( () => input.root.focus() );
                        this._editingDescription = true;
                    } )
                }
            }
        }

        let [ canvasArea, canvasControlsArea ] = graphicsArea.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });

        const canvas = document.createElement("canvas");
        canvas.className = "w-full h-full rounded-t-lg";
        canvas.tabIndex = "1";
        canvasArea.attach( canvas );

        let lastDownTarget = null;
        let generateKbTexture = true;
        document.addEventListener('mousedown', (e) => {
            lastDownTarget = e.target;
        }, false);

        document.addEventListener('keydown', async (e) => {
            if (lastDownTarget == canvas) {
                this.keyState.set( CODE2ASCII[ e.code ], true );
                if( generateKbTexture ) await this.createKeyboardTexture();
                generateKbTexture = false;
            }
        }, false);

        document.addEventListener('keyup', async (e) => {
            if (lastDownTarget == canvas) {
                this.keyState.set( CODE2ASCII[ e.code ], false );
                this.keyToggleState.set( CODE2ASCII[ e.code ], !( this.keyToggleState.get( CODE2ASCII[ e.code ] ) ?? false ) );
                this.keyPressed.set( CODE2ASCII[ e.code ], true );
                this._anyKeyPressed = true;
                await this.createKeyboardTexture();
                generateKbTexture = true;
            }
        }, false);

        canvas.addEventListener("mousedown", (e) => {
            e.preventDefault();
            this._mouseDown = e;
            this.mousePosition = [ e.offsetX, this.gpuCanvas.offsetHeight - e.offsetY ];
            this.lastMousePosition = [ ...this.mousePosition ];
            this._mousePressed = true;
        });

        canvas.addEventListener("mouseup", (e) => {
            e.preventDefault();
            this._mouseDown = undefined;
        });

        canvas.addEventListener("mousemove", (e) => {
            if( this._mouseDown )
            {
                e.preventDefault();
                this.mousePosition = [ e.offsetX, this.gpuCanvas.offsetHeight - e.offsetY ];
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

            panel.sameLine();
            panel.addButton( null, "Record", ( name, event ) => {
                // TODO: Record gif/video/...
            }, { icon: "Video", className: "ml-auto", title: "Record", tooltip: true } );
            panel.addButton( null, "Fullscreen", this.requestFullscreen.bind( this ), { icon: "Fullscreen", title: "Fullscreen", tooltip: true } );

            panel.endLine( "items-center h-full ml-auto" );
        }
    },

    async createStatusBarButtons( p ) {

        const customTabInfoButtonsPanel = new LX.Panel( { className: "flex flex-row items-center", height: "auto" } );

        customTabInfoButtonsPanel.sameLine();

        // Default Uniforms list info
        {
            const defaultParametersContainer = LX.makeContainer(
                [ `${ Math.min( 600, window.innerWidth - 64 ) }px`, "auto" ],
                "overflow-scroll",
                "",
                null,
                { maxHeight: "256px", maxWidth: `${ window.innerWidth - 64 }px` }
            );

            LX.makeContainer( ["auto", "auto"], "flex flex-row p-2 items-center", "Default Uniforms", defaultParametersContainer );

            // Create the content for the uniforms panel
            {
                this.defaultParametersPanel = new LX.Panel({ className: "custom-parameters-panel w-full" });
                defaultParametersContainer.appendChild( this.defaultParametersPanel.root );

                this.defaultParametersPanel.refresh = () => {

                    this.defaultParametersPanel.clear();

                    for( let u of DEFAULT_UNIFORMS_LIST )
                    {
                        this.defaultParametersPanel.sameLine( 2, "justify-between" );
                        this.defaultParametersPanel.addLabel( `${ u.name } : ${ u.type }`, { className: "w-full p-0" } );
                        this.defaultParametersPanel.addLabel( u.info, { className: "w-full p-0", inputClass: "text-end" } );
                    }
                }

                this.defaultParametersPanel.refresh();
            }

            customTabInfoButtonsPanel.addButton( null, "OpenDefaultParams", ( name, event ) => {
                new LX.Popover( event.target, [ defaultParametersContainer ], { align: "start", side: "top" } );
            }, { icon: "BookOpen", title: "Default Parameters", tooltip: true } );
        }

        // Custom Uniforms info
        {
            const customParametersContainer = LX.makeContainer(
                [`${ Math.min( 600, window.innerWidth - 64 ) }px`, "auto"],
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

            this.openCustomParamsButton = customTabInfoButtonsPanel.addButton( null, "OpenCustomParams", ( name, event ) => {
                this.openCustomUniforms( event.target );
            }, { icon: "Settings2", title: "Custom Parameters", tooltip: true } );
        }

        customTabInfoButtonsPanel.addButton( null, "CompileShaderButton", this.compileShader.bind( this ), { icon: "Play", width: "32px", title: "Compile", tooltip: true } );

        customTabInfoButtonsPanel.endLine();

        p.root.prepend( customTabInfoButtonsPanel.root );
    },

    async openAvailableChannels( channelIndex ) {

        this.currentChannelIndex = channelIndex;

        const _createChannelItems = async ( category, container ) => {

            const result = await fs.listDocuments( FS.ASSETS_COLLECTION_ID, [
                Query.equal( "category", category )
            ] );

            if( result.total === 0 )
            {
                LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No channels found.", container );
                return;
            }

            for( const document of result.documents )
            {
                const channelItem = LX.makeElement( "li", "relative flex rounded-lg bg-secondary hover:bg-tertiary overflow-hidden", "", container );
                channelItem.style.maxHeight = "200px";
                const channelPreview = LX.makeElement( "img", "w-full h-full rounded-t-lg bg-secondary hover:bg-tertiary border-none cursor-pointer", "", channelItem );
                const fileId = document[ "file_id" ];
                const preview = document[ "preview" ];
                channelPreview.src = preview ? await fs.getFileUrl( preview ) : ( fileId ? await fs.getFileUrl( fileId ) : "images/shader_preview.png" );
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "absolute top-0 p-2 w-full bg-blur items-center select-none text-sm font-bold", `
                    ${ document.name } (uint8)
                `, channelItem );
                channelItem.addEventListener( "click", async ( e ) => {
                    e.preventDefault();
                    if( category === "misc" )
                    {
                        switch( document.name )
                        {
                            case "keyboard":
                            await this.createKeyboardTexture( this.currentChannelIndex, true );
                            break;
                        }
                    }
                    else if( category === "texture" ) // Use this image as a texture
                    {
                        this.loadChannelFromFile( fileId, this.currentChannelIndex );
                    }

                    this.currentChannelIndex = undefined;
                    dialog.close();
                } );
            }
        }

        const area = new LX.Area( { skipAppend: true } );
        const tabs = area.addTabs( { parentClass: "bg-secondary p-4", sizes: [ "auto", "auto" ], contentClass: "bg-secondary p-4 pt-0" } );

        const texturesContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-4 p-4 border rounded-lg justify-center overflow-scroll" );
        await _createChannelItems( "texture", texturesContainer );
        tabs.add( "Textures", texturesContainer, { selected: true } );

        const miscContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-4 p-4 border rounded-lg justify-center overflow-scroll" );
        await _createChannelItems( "misc", miscContainer );
        tabs.add( "Misc", miscContainer, { xselected: true } );

        let dialog = new LX.Dialog( `Channel${ channelIndex } input:`, (p) => {
            p.attach( area );
        }, { modal: false, close: true, minimize: false, size: [`${ Math.min( 1280, window.innerWidth - 64 ) }px`, "512px"], draggable: true });
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
                    document.getElementById( "signupContainer" )?.classList.add( "hidden" );
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
        window.location.href = `${ window.location.origin + window.location.pathname }?shader=new`;
    },

    async updateShaderName( shaderName ) {

        const shaderUid = this.shader.uid;

        // update DB
        // ...

        this.shader.name = shaderName;
    },

    async saveShaderFiles() {

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

        // Upload document and get id
        const filename = "main.wgsl";
        const code = this.loadedFiles[ filename ].replaceAll( '\r', '' );
        const arraybuffer = new TextEncoder().encode( code );
        const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
        let result = await fs.createFile( file );
        newFileId += result[ "$id" ];

        return newFileId;
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

        const dialog = new LX.Dialog( "Confirm Shader name", ( p ) => {
            let shaderName = this.shader.name;
            const textInput = p.addText( "Name", shaderName, ( v ) => {
                shaderName = v;
            }, { pattern: LX.buildTextPattern( { minLength: 3 } ) } );
            p.addSeparator();
            p.sameLine( 2 );
            p.addButton( null, "Cancel", () => dialog.close(), { width: "50%", buttonClass: "bg-error fg-white" } );
            p.addButton( null, "Confirm", async () => {
                if( !shaderName.length || !textInput.valid( shaderName ) )
                {
                    return;
                }

                const newFileId = await this.saveShaderFiles();

                // Create a new shader in the DB
                const result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
                    "name": shaderName,
                    "author_id": fs.getUserId(),
                    "file_id": newFileId,
                    "description": this.shader.description,
                    "channels": JSON.stringify( this.shader.channels ),
                    "uniforms": JSON.stringify( this.shader.uniforms ),
                } );

                this.shader.uid = result[ "$id" ];
                this.shader.name = shaderName;

                // Upload canvas snapshot
                await this.updateShaderPreview( this.shader.uid, false );

                // Close dialog on succeed and show toast
                dialog.close();
                LX.toast( `✅ Shader saved`, `Shader: ${ shaderName } by ${ fs.user.name }`, { position: "top-right" } );
            }, { width: "50%", buttonClass: "contrast" } );
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

        const newFileId = await this.saveShaderFiles();

        // Update files reference in the DB
        await fs.updateDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid, {
            "file_id": newFileId,
            "description": this.shader.description,
            "channels": JSON.stringify( this.shader.channels ),
            "uniforms": JSON.stringify( this.shader.uniforms )
        } );

        // Update canvas snapshot
        await this.updateShaderPreview( this.shader.uid, false );

        LX.toast( `✅ Shader updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );
    },

    async deleteShader() {

        let result = await this.shaderExists();
        if( !result )
        {
            return;
        }

        const innerDelete = async () => {

            // DB entry
            await fs.deleteDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid );

            // Shader files
            const fileIdString = result[ "file_id" ];
            const fileIds = fileIdString.split( "," );
            for( const fid of fileIds )
            {
                await fs.deleteFile( fid );
            }

            // Preview
            const previewName = `${ this.shader.uid }.png`;
            result = await fs.listFiles( [ Query.equal( "name", previewName ) ] );
            if( result.total > 0 )
            {
                await fs.deleteFile( result.files[ 0 ][ "$id" ] );
            }

            LX.toast( `✅ Shader deleted`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );

        };

        const dialog = new LX.Dialog( "Delete shader", (p) => {
            p.root.classList.add( "p-2" );
            p.addTextArea( null, "Are you sure? This action cannot be undone.", null, { disabled: true } );
            p.addSeparator();
            p.sameLine( 2 );
            p.addButton( null, "Cancel", () => dialog.close(), { width: "50%", buttonClass: "bg-error fg-white" } );
            p.addButton( null, "Continue", innerDelete.bind( this ), { width: "50%", buttonClass: "contrast" } );
        }, { modal: true } );
    },

    async remixShader() {

        // Save the shader with you as the author id
        // Create a new col to store original_id so it can be shown in the page
        // Get the new shader id, and reload page in shader view with that id

        const shaderName = this.shader.name;
        const shaderUid = this.shader.uid;
        const newFileId = await this.saveShaderFiles();

        // Create a new shader in the DB
        result = await fs.createDocument( FS.SHADERS_COLLECTION_ID, {
            "name": shaderName,
            "author_id": fs.getUserId(),
            "original_id": shaderUid,
            "file_id": newFileId,
            "description": this.shader.description,
            "channels": JSON.stringify( this.shader.channels ),
            "uniforms": JSON.stringify( this.shader.uniforms ),
        } );

        // Upload canvas snapshot
        await this.updateShaderPreview( shaderUid, false );

        // Go to shader edit view with the new shader
        window.location.href = `${ window.location.origin + window.location.pathname }?shader=${ result[ "$id" ] }`;
    },

    async updateShaderPreview( shaderUid, showFeedback = true ) {

        shaderUid = shaderUid ?? this.shader.uid;

        // Delete old preview first if necessary
        const previewName = `${ shaderUid }.png`;
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
            LX.toast( `✅ Shader preview updated`, `Shader: ${ this.shader.name } by ${ fs.user.name }`, { position: "top-right" } );
        }
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

            this.timeDeltaBuffer = this.device.createBuffer({
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

            this.mouseBuffer = this.device.createBuffer({
                size: 16,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
            });
        }

        this.sampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });

        let usesKeyboardChannel = false;

        // Load any necessary texture channels for the current shader
        for( let i = 0; i < this.shader.channels?.length ?? 0; ++i )
        {
            if( this.shader.channels[ i ] === "keyboard" )
            {
                usesKeyboardChannel = true;
                continue;
            }

            await this.createTexture( this.shader.channels[ i ], i );
        }

        // Create render pipeline based on editor shaders
        // If uses keyboard, it will create the pipeline after the texture
        if( !usesKeyboardChannel )
        {
            await this.createRenderPipeline( true, true );
        }
        else
        {
            // In case any channel is using it, it will be used in that
            // channel and update the channel image src
            await this.createKeyboardTexture( undefined, true );
        }

        const frame = async () => {

            const now = LX.getTime();

            this.timeDelta = ( now - this.lastTime ) / 1000;

            if( !this.timePaused )
            {
                this.device.queue.writeBuffer(
                    this.timeDeltaBuffer,
                    0,
                    new Float32Array([ this.timeDelta ])
                );

                this.device.queue.writeBuffer(
                    this.timeBuffer,
                    0,
                    new Float32Array([ this.elapsedTime ])
                );

                this.elapsedTime += this.timeDelta;

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

            this.device.queue.writeBuffer(
                this.mouseBuffer,
                0,
                new Float32Array([
                    this.mousePosition[ 0 ], this.mousePosition[ 1 ],
                    this.lastMousePosition[ 0 ] * ( this._mouseDown ? 1.0 : -1.0 ), this.lastMousePosition[ 1 ] * ( this._mousePressed ? 1.0 : -1.0 ) ])
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

            if( this._anyKeyPressed )
            {
                // event consumed, Clean input
                for( const [ name, value ] of this.keyPressed )
                {
                    this.keyPressed.set( name, false );
                }

                await this.createKeyboardTexture();

                this._anyKeyPressed = false;
            }

            this._mousePressed = false;

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
                    if( u.skipBindings ?? false ) return;
                    return `@group(0) @binding(${ bindingIndex++ }) var<uniform> ${ u.name } : ${ u.type };`;
                } ).filter( u => u !== undefined ) );
            }

            // Custom Uniform bindings
            {
                if( this.shader.uniforms.length !== this.shader.uniformBuffers.length )
                {
                    this.shader.uniformBuffers.length = this.shader.uniforms.length; // Set new length

                    for( let i = 0; i < this.shader.uniformBuffers.length; ++i )
                    {
                        const buffer = this.shader.uniformBuffers[ i ];
                        if( !buffer )
                        {
                            this.shader.uniformBuffers[ i ] = this.device.createBuffer({
                                size: 4,
                                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.UNIFORM,
                            });
                        }
                    }
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
                    if( u.skipBindings ?? false ) return;
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
                resource: { buffer: this.timeBuffer }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.timeDeltaBuffer }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.frameCountBuffer }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.resolutionBuffer }
            },
            {
                binding: bindingIndex++,
                resource: { buffer: this.mouseBuffer }
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

        if( !fileId )
        {
            return;
        }

        const url = await fs.getFileUrl( fileId );
        const data = await fs.requestFile( url );
        const imageBitmap = await createImageBitmap( await new Blob([data]) );
        const dimensions = [ imageBitmap.width, imageBitmap.height ];
        const imageTexture = this.device.createTexture({
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
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

    async createKeyboardTexture( channel, updatePreview ) {

        const dimensions = [ 256, 3 ];
        const data = [];

        // Key state
        for( let w = 0; w < dimensions[ 0 ]; w++ )
        {
            data.push( 255 * ( this.keyState.get( w ) === true ? 1 : 0 ), 0, 0, 255 );
        }

        // Key toggle state
        for( let w = 0; w < dimensions[ 0 ]; w++ )
        {
            data.push( 255 * ( this.keyToggleState.get( w ) === true ? 1 : 0 ), 0, 0, 255 );
        }

        // Key pressed
        for( let w = 0; w < dimensions[ 0 ]; w++ )
        {
            data.push( 255 * ( this.keyPressed.get( w ) === true ? 1 : 0 ), 0, 0, 255 );
        }

        const imageData = new ImageData( new Uint8ClampedArray( data ), dimensions[ 0 ], dimensions[ 1 ] );
        const imageBitmap = await createImageBitmap( imageData );
        const imageTexture = this.device.createTexture({
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
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

        const imageName = "keyboard";
        const usedChannel = this.shader.channels.indexOf( imageName );

        if( ( channel === undefined ) && usedChannel > -1 )
        {
            channel = usedChannel;
        }

        if( channel !== undefined )
        {
            this.uniformChannels[ channel ] = imageTexture;
            this.shader.channels[ channel ] = imageName;
            
            await this.createRenderPipeline();

            if( updatePreview )
            {
                this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = await fs.getFileUrl( "68c04102000cc75e3d61" );
            }
        }
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

        this.shader.channels[ channel ] = file;

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

    async addUniform( name, value, min, max ) {

        const uName = name ?? `iUniform${ this.shader.uniforms.length + 1 }`;
        this.shader.uniforms.push( { name: uName, value: value ?? 0, min: min ?? 0, max: max ?? 1 } );
        const allCode = this.getShaderCode( false );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            this.createRenderPipeline( true, true );
        }
    },

    openCustomUniforms( target ) {

        target = target ?? this.openCustomParamsButton.root;

        if( this._lastUniformsDialog )
        {
            this._lastUniformsDialog.close();
        }

        // Refresh content first
        this.customParametersPanel.refresh();

        new LX.Popover( target, [ this.customParametersPanel.root.parentElement ], { align: "start", side: "top" } );
    },

    resetShaderElapsedTime() {

        this.frameCount = 0;
        this.elapsedTime = 0;
        this.timeDelta = 0;

        this.device.queue.writeBuffer(
            this.timeDeltaBuffer,
            0,
            new Float32Array([ this.timeDelta ])
        );

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
    }
}

await ShaderHub.initUI();

window.LX = LX;
window.ShaderHub = ShaderHub;
window.fs = fs;
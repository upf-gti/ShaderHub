import { LX } from 'lexgui';
// import 'lexgui/extensions/codeeditor.js';
import './extra/codeeditor.js';
import * as Constants from "./constants.js";
import * as Utils from './utils.js';
import { FS } from './fs.js';
import { Shader, ShaderPass } from './graphics.js';

const WEBGPU_OK     = 0;
const WEBGPU_ERROR  = 1;

const ERROR_CODE_DEFAULT    = 0;
const ERROR_CODE_SUCCESS    = 1;
const ERROR_CODE_ERROR      = 2;

const fs = new FS();
const Query = Appwrite.Query;
const mobile = Utils.isMobile();

const ShaderHub = {

    textures: {},
    buffers: {},
    renderPipelines: [],
    renderBindGroups: [],

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
            await this.createBrowseListUI();
        }
    },

    async createBrowseListUI() {

        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.className += " overflow-scroll";
        bottomArea.root.className += " items-center content-center";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 self-center align-center ml-auto mr-auto", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea );

        let skeletonHtml = "";

        for( let i = 0; i < 10; ++i )
        {
            skeletonHtml += `
            <div class="shader-item overflow-hidden flex flex-col h-auto">
                <img class="w-full lexskeletonpart" width="640" height="360" src="${ Constants.IMAGE_EMPTY_SRC }"></img>
                <div class="flex flex-col w-full mt-2 gap-2">
                    <div class="w-full h-4 lexskeletonpart"></div>
                    <div class="w-2/3 h-4 lexskeletonpart"></div>
                </div>
            </div>`;
        }

        const skeleton = new LX.Skeleton( skeletonHtml );
        skeleton.root.classList.add( "grid", "shader-list", "gap-8", "p-8", "justify-center" );
        topArea.attach( skeleton.root );

        LX.doAsync( async () => {

            const listContainer = LX.makeContainer( ["100%", "auto"], "grid shader-list gap-8 p-8 justify-center", "", topArea );

            // Get all stored shader files (not the code, only the data)
            const result = await fs.listDocuments( FS.SHADERS_COLLECTION_ID );

            let shaderList = [];

            for( const document of result.documents )
            {
                const name = document.name;

                const shaderInfo = {
                    name,
                    uid: document[ "$id" ],
                    creationDate: Utils.toESDate( document[ "$createdAt" ] )
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

                shaderList.push( shaderInfo );
            }

            shaderList = shaderList.sort( (a, b) => a.name.localeCompare( b.name ) );

            skeleton.destroy();

            for( const shader of shaderList )
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
        }, 200 );
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

            const shaderData = {
                name: result.name,
                uid: shaderUid,
                url: await fs.getFileUrl( result[ "file_id" ] ),
                description: result.description ?? "",
                creationDate: Utils.toESDate( result[ "$createdAt" ] )
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
            const shaderData = {
                name: "New Shader",
                uid: "EMPTY_ID",
                author: fs.user?.name ?? "Anonymous",
                anonAuthor: true,
                creationDate: Utils.getDate()
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

        let [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", "20%"], resize: false });
        codeArea.root.className += " rounded-lg overflow-hidden code-border-default";
        shaderSettingsArea.root.className += " content-center";

        this.getChannelUrl = async ( pass, channel ) => {

            if( !pass ) return Constants.IMAGE_EMPTY_SRC;
            const assetFileId = pass.channels[ channel ];
            if( !assetFileId ) return Constants.IMAGE_EMPTY_SRC;
            if( assetFileId === "Keyboard" ) return "images/keyboard.png";
            if( assetFileId.startsWith( "Buffer" ) ) return "images/buffer.png";
            const result = await fs.listDocuments( FS.ASSETS_COLLECTION_ID, [ Query.equal( "file_id", assetFileId ) ] );
            console.assert( result.total == 1, `Inconsistent asset list for file id ${ assetFileId }` );
            const preview = result.documents[ 0 ][ "preview" ];
            return preview ? await fs.getFileUrl( preview ) : await fs.getFileUrl( assetFileId );
        }

        this.channelsContainer = LX.makeContainer( ["100%", "100%"], "channel-list grid gap-2 pt-2 items-center justify-center bg-primary", "", shaderSettingsArea );

        this.updateShaderChannelsUI = async ( pass ) => {

            pass = pass ?? this.currentPass;

            this.toggleShaderChannelsUIView( pass.type === "common" );

            this.channelsContainer.innerHTML = "";

            for( let i = 0; i < Constants.UNIFORM_CHANNELS_COUNT; i++ )
            {
                const channelContainer = LX.makeContainer( ["100%", "100%"], "relative text-center content-center rounded-lg bg-secondary hover:bg-tertiary cursor-pointer overflow-hidden", "", this.channelsContainer );
                channelContainer.style.minHeight = "100px";
                const channelImage = LX.makeElement( "img", "rounded-lg bg-secondary hover:bg-tertiary border-none", "", channelContainer );
                channelImage.src = await this.getChannelUrl( pass, i )
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

        this.toggleShaderChannelsUIView = async ( force ) => {
            this.channelsContainer.parentElement.classList.toggle( "hidden", force );
        }

        document.title = `${ this.shader.name } (${ this.shader.author }) - ShaderHub`;

        // Manage code area resize when channels are collapsed
        {
            if( window.ResizeObserver )
            {
                const ro = new ResizeObserver( function( entries, observer )
                {
                    var entry = entries[ 0 ];
                    let box = entry.contentRect;
                    codeArea.root.style.height = `calc(100% - ${ box.height }px)`;
                });

                ro.observe( shaderSettingsArea.root );
            }
        }

        const customSuggestions = [];
        Constants.DEFAULT_UNIFORM_NAMES.forEach( u => {
            if( u.startsWith( "iChannel" ) )
            {
                customSuggestions.push( "iChannel" );
            }
            else
            {
                customSuggestions.push( u );
            }
        } );

        this.editor = await new LX.CodeEditor( codeArea, {
            allowClosingTabs: false,
            allowLoadingFiles: false,
            fileExplorer: false,
            defaultTab: false,
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            customSuggestions,
            onCreateStatusPanel: this.createStatusBarButtons.bind( this ),
            onCtrlSpace: this.compileShader.bind( this ),
            onSave: this.compileShader.bind( this ),
            onRun: this.compileShader.bind( this ),
            onCreateFile: ( editor ) => null,
            onContextMenu: ( editor, content, event ) => {
                const passName = editor.getSelectedTabName();
                if( passName === "Common" )
                {
                    return;
                }

                const word = content.trim().match( /([A-Za-z0-9_]+)/g )[ 0 ];
                if( !word )
                {
                    return;
                }

                const pass = this.shader.passes.find( p => p.name === passName );
                const options = [];
                const USED_UNIFORM_NAMES = [ ...DEFAULT_UNIFORM_NAMES, ...pass.uniforms.map( u => u.name ) ];
                const regex = new RegExp( "\\b(?!(" + USED_UNIFORM_NAMES.join("|") + ")\\b)(i[A-Z]\\w*)\\b" );

                options.push( { path: "Create Uniform", disabled: !regex.test( word ), callback: async () => {
                    await this.addUniform( word );
                    await this.compileShader( true, pass );
                    this.openCustomUniforms();
                } } );

                return options;
            },
            onNewTab: ( e ) => {
                const canCreateCommon = ( this.shader.passes.filter( p => p.type === "common" ).length === 0 );
                const canCreateBuffer = ( this.shader.passes.filter( p => p.type === "buffer" ).length < 4 );

                const dmOptions = [
                    { name: "Buffer", icon: "FilePlus", disabled: !canCreateBuffer, callback: this.onCreatePass.bind( this, "buffer" ) },
                    { name: "Common", icon: "FileUp", disabled: !canCreateCommon, callback: this.onCreatePass.bind( this, "common" ) },
                ];

                new LX.DropdownMenu( e.target, dmOptions, { side: "bottom", align: "start" });
            },
            onSelectTab: async ( name, editor ) => {
                this.currentPass = this.shader.passes.find( p => p.name === name );
                console.assert( this.currentPass, `Cannot find pass ${ name }` );
                await this.updateShaderChannelsUI();
            }
        });

        // LX.doAsync( () => {
        //     const channelsContainerHeight = this.channelsContainer.getBoundingClientRect().height;
        //     console.log(channelsContainerHeight);
        //     codeArea.root.style.height = `calc(100% - ${ channelsContainerHeight + 16 }px)`;
        // }, 10 );

        var [ graphicsArea, shaderDataArea ] = leftArea.split({ type: "vertical", sizes: ["auto", "auto"], resize: false });

        const ownProfile = fs.user && ( this.shader.authorId === fs.getUserId() );

        // Add Shader data
        {
            shaderDataArea.root.className += " pt-2 items-center justify-center bg-primary";
            const shaderDataContainer = LX.makeContainer( [`100%`, "100%"], "p-6 flex flex-col gap-2 rounded-lg bg-secondary overflow-scroll overflow-x-hidden", "", shaderDataArea );
            const shaderNameAuthorOptionsContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-row", `
                <div class="flex flex-col gap-1">
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

            const shaderOptions = LX.makeContainer( [`auto`, "auto"], "ml-auto flex flex-row p-1 gap-1 self-start items-center", ``, shaderNameAuthorOptionsContainer );

            if( fs.user )
            {
                const shaderOptionsButton = new LX.Button( null, "ShaderOptions", async () => {

                    const dmOptions = [ ]

                    if( ownProfile || isNewShader )
                    {
                        let result = await this.shaderExists();

                        dmOptions.push( mobile ? 0 : { name: "Save Shader", icon: "Save", callback: () => this.saveShader( result ) } );

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
                    <div class="w-auto self-start mt-1">${ ( ownProfile || ( shaderUid === "new" ) ) ? LX.makeIcon("Edit", { svgClass: "mr-3 cursor-pointer hover:fg-primary" } ).innerHTML : "" }</div>
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
        canvas.className = "webgpu-canvas w-full h-full rounded-t-lg";
        canvas.tabIndex = "0";
        canvasArea.attach( canvas );

        // Manage canvas resize
        {
            let iResize = ( xResolution, yResolution ) => {
                canvas.width = xResolution;
                canvas.height = yResolution;
                this.resolutionX = xResolution;
                this.resolutionY = yResolution;
                // me.ResizeBuffers( xResolution, yResolution );
                // resizeCallback( xResolution, yResolution );
            };

            let bestAttemptFallback = () => {
                let devicePixelRatio = window.devicePixelRatio || 1;
                let xResolution = Math.round( canvas.offsetWidth  * devicePixelRatio ) | 0;
                let yResolution = Math.round( canvas.offsetHeight * devicePixelRatio ) | 0;
                iResize( xResolution, yResolution );
            };

            if( !window.ResizeObserver )
            {
                console.warn( "This browser doesn't support ResizeObserver." );
                bestAttemptFallback();
                window.addEventListener( "resize", bestAttemptFallback );
            }
            else
            {
                this.ro = new ResizeObserver( function( entries, observer )
                {
                    var entry = entries[ 0 ];
                    if( !entry['devicePixelContentBoxSize'] )
                    {
                        observer.unobserve( canvas );
                        console.warn( "This browser doesn't support ResizeObserver + device-pixel-content-box (2)" );
                        bestAttemptFallback();
                        window.addEventListener( "resize", bestAttemptFallback );
                    }
                    else
                    {
                        let box = entry.devicePixelContentBoxSize[ 0 ];
                        iResize( box.inlineSize, box.blockSize );
                    }
                });

                try
                {
                    this.ro.observe( canvas, { box: ["device-pixel-content-box"] } );
                }
                catch( e )
                {
                    console.warn( "This browser doesn't support ResizeObserver + device-pixel-content-box (1)");
                    bestAttemptFallback();
                    window.addEventListener( "resize", bestAttemptFallback );
                }
            }
        }

        let generateKbTexture = true;

        canvas.addEventListener('keydown', async (e) => {
            this.keyState.set( Utils.code2ascii( e.code ), true );
            if( generateKbTexture ) await this.createKeyboardTexture();
            generateKbTexture = false;
            e.preventDefault();
        }, false);

        canvas.addEventListener('keyup', async (e) => {
            this.keyState.set( Utils.code2ascii( e.code ), false );
            this.keyToggleState.set( Utils.code2ascii( e.code ), !( this.keyToggleState.get( Utils.code2ascii( e.code ) ) ?? false ) );
            this.keyPressed.set( Utils.code2ascii( e.code ), true );
            this._anyKeyPressed = true;
            await this.createKeyboardTexture();
            generateKbTexture = true;
            e.preventDefault();
        }, false);

        canvas.addEventListener("mousedown", (e) => {
            this._mouseDown = e;
            this.mousePosition = [ e.offsetX, this.gpuCanvas.offsetHeight - e.offsetY ];
            this.lastMousePosition = [ ...this.mousePosition ];
            this._mousePressed = true;
        });

        canvas.addEventListener("mouseup", (e) => {
            this._mouseDown = undefined;
        });

        canvas.addEventListener("mousemove", (e) => {
            if( this._mouseDown )
            {
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
            panel.addButton( null, "Fullscreen", () => this.requestFullscreen( this.gpuCanvas ), { icon: "Fullscreen", title: "Fullscreen", tooltip: true } );

            panel.endLine( "items-center h-full ml-auto" );
        }

        // Load shader json data and start graphics
        {
            await this.initGraphics( canvas );

            const closeFn = ( name, e ) => {
                e.preventDefault();
                e.stopPropagation();
                editor.tabs.delete( name );
                document.body.querySelectorAll( ".lextooltip" ).forEach( e => e.remove() );

                // Destroy pass
                {
                    const passIndex = this.shader.passes.findIndex( p => p.name === name );
                    const pass = this.shader.passes[ passIndex ];
                    if( pass.type === "buffer" )
                    {
                        delete this.buffers[ pass.name ];
                    }

                    this.shader.passes.splice( passIndex, 1 );
                    this.renderPipelines.splice( passIndex, 1 );
                    this.renderBindGroups.splice( passIndex, 1 );

                    this.compileShader();
                }
            };

            // Prob. new shader
            if( !this.shader.url )
            {
                const pass = {
                    name: "MainImage",
                    type: "image",
                    codeLines: Shader.RENDER_MAIN_TEMPLATE
                }

                const shaderPass = new ShaderPass( this.shader, this.device, pass );
                this.shader.passes.push( shaderPass );

                // Set code in the editor
                this.editor.addTab( pass.name, false, pass.name, { codeLines: pass.codeLines, language: "WGSL" } );
            }
            else
            {
                const json = JSON.parse( await fs.requestFile( this.shader.url, "text" ) );
                console.assert( json, "DB: No JSON Shader data available!" );

                for( const pass of json.passes ?? [] )
                {
                    // Push passes to the shader
                    const shaderPass = new ShaderPass( this.shader, this.device, pass );
                    if( pass.type === "buffer" )
                    {
                        console.assert( shaderPass.textures, "Buffer does not have render target textures" );
                        this.buffers[ pass.name ] = shaderPass.textures;
                    }
                    this.shader.passes.push( shaderPass );

                    // Set code in the editor
                    const code = pass.codeLines.join( "\n" );
                    this.editor.addTab( pass.name, false, pass.name, { codeLines: pass.codeLines, language: "WGSL" } );

                    if( pass.name !== "MainImage" )
                    {
                        const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
                        LX.asTooltip( closeIcon, "Delete file" );
                        closeIcon.addEventListener( "click", closeFn.bind( this, pass.name ) );
                        editor.tabs.tabDOMs[ pass.name ].appendChild( closeIcon );
                    }
                }
            }

            this.currentPass = this.shader.passes.at( -1 );
            this.editor.loadTab( this.currentPass.name );
        }
    },

    async createStatusBarButtons( p, editor ) {

        const customTabInfoButtonsPanel = new LX.Panel( { className: "flex flex-row items-center", height: "auto" } );

        customTabInfoButtonsPanel.sameLine();

        /*
            Default Uniforms list info
        */

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

                for( let u of Constants.DEFAULT_UNIFORMS_LIST )
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

        /*
            Custom Uniforms info
        */

        const customParametersContainer = LX.makeContainer(
            [`${ Math.min( 600, window.innerWidth - 64 ) }px`, "auto"],
            "overflow-scroll",
            "",
            null,
            { maxHeight: "256px", maxWidth: `${ window.innerWidth - 64 }px` }
        );

        const uniformsHeader = LX.makeContainer( ["auto", "auto"], "flex flex-row p-2 items-center", "", customParametersContainer );
        const uniformsCountTitle = LX.makeContainer( ["auto", "auto"], "", `Uniforms [0]`, uniformsHeader );
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

                const passName = editor.getSelectedTabName();
                const pass = this.shader.passes.find( p => p.name === passName );
                if( !pass || pass.type === "common" ) return;

                overridePanel = overridePanel ?? this.customParametersPanel;

                overridePanel.clear();

                overridePanel.addLabel( "Uniform names must start with i + Capital letter (e.g. iTime)." );

                for( let u of pass.uniforms )
                {
                    overridePanel.sameLine( 5 );
                    overridePanel.addText( null, u.name, ( v ) => {
                        u.name = v;
                        this.compileShader( true, pass );
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
                        const allCode = pass.getShaderCode( false );
                        const idx = pass.uniforms.indexOf( u );
                        pass.uniforms.splice( idx, 1 );
                        this.customParametersPanel.refresh( overridePanel );
                        if( allCode.match( new RegExp( `\\b${ u.name }\\b` ) ) )
                        {
                            this.compileShader( true, pass );
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
                    uniformsCountTitle.innerHTML = `Uniforms [${ pass.uniforms.length }]`;

                    if( LX.Popover.activeElement )
                    {
                        LX.Popover.activeElement._adjustPosition();
                    }
                }
            }
        }

        this.openCustomParamsButton = customTabInfoButtonsPanel.addButton( null, "OpenCustomParams", ( name, event ) => {
            this.customParametersPanel.refresh()
            this.openCustomUniforms( event.target );
        }, { icon: "Settings2", title: "Custom Parameters", tooltip: true } );

        /*
            Compile Button
        */

        customTabInfoButtonsPanel.addButton( null, "CompileShaderButton", async () => {
            await this.compileShader();
            this.gpuCanvas.focus();
        }, { icon: "Play", width: "32px", title: "Compile", tooltip: true } );

        customTabInfoButtonsPanel.endLine();

        p.root.prepend( customTabInfoButtonsPanel.root );
    },

    onCreatePass( passType, passName ) {

        let indexOffset = -1;

        const shaderPass = new ShaderPass( this.shader, this.device, { name: passName, type: passType } );

        if( passType === "buffer" )
        {
            const getNextBufferName = () => {
                const usedNames = this.shader.passes.filter( p => p.type === "buffer" ).map( p => p.name );
                const possibleNames = ["BufferA", "BufferB", "BufferC", "BufferD"];

                // Find the first unused name
                for( const name of possibleNames )
                {
                    if( !usedNames.includes( name )) return name;
                }

                // All used, should not happen due to prev checks
                return null;
            }

            indexOffset = -2;
            passName = shaderPass.name = getNextBufferName();
            this.shader.passes.splice( this.shader.passes.length - 1, 0, shaderPass ); // Add before MainImage

            console.assert( shaderPass.textures, "Buffer does not have render target textures" );
            this.buffers[ passName ] = shaderPass.textures;
        }
        else if( passType === "common" )
        {
            indexOffset = -( this.shader.passes.length + 1 );
            this.shader.passes.splice( 0, 0, shaderPass ); // Add at the start
        }

        this.editor.addTab( passName, true, passName, {
            indexOffset,
            language: "WGSL",
            codeLines: shaderPass.codeLines
        } );

        // Wait for the tab to be created
        LX.doAsync( () => {

            const closeIcon = LX.makeIcon( "X", { iconClass: "ml-2" } );
            LX.asTooltip( closeIcon, "Delete file" );
            closeIcon.addEventListener( "click", (e) => {
                e.preventDefault();
                e.stopPropagation();
                editor.tabs.delete( passName );
                document.body.querySelectorAll( ".lextooltip" ).forEach( e => e.remove() );
            } );

            this.editor.tabs.tabDOMs[ passName ].appendChild( closeIcon );

        }, 10 );
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

            const passName = this.editor.getSelectedTabName();
            const pass = this.shader.passes.find( p => p.name === passName );

            for( const document of result.documents )
            {
                const channelItem = LX.makeElement( "li", "relative flex rounded-lg bg-secondary hover:bg-tertiary overflow-hidden", "", container );
                channelItem.style.maxHeight = "200px";
                const channelPreview = LX.makeElement( "img", "w-full h-full rounded-t-lg bg-secondary hover:bg-tertiary border-none cursor-pointer", "", channelItem );
                const fileId = document[ "file_id" ];
                const preview = document[ "preview" ];
                const localUrl = document[ "local_url" ];
                channelPreview.src = preview ? await fs.getFileUrl( preview ) : ( fileId ? await fs.getFileUrl( fileId ) : ( localUrl ?? "images/shader_preview.png" ) );
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "absolute top-0 p-2 w-full bg-blur items-center select-none text-sm font-bold", `
                    ${ document.name } (uint8)
                `, channelItem );
                channelItem.addEventListener( "click", async ( e ) => {
                    e.preventDefault();
                    if( category === "misc" )
                    {
                        switch( document.name )
                        {
                            case "Keyboard":
                            await this.createKeyboardTexture( this.currentChannelIndex, true );
                            break;
                            case "BufferA":
                            case "BufferB":
                            case "BufferC":
                            case "BufferD":
                            await this.loadBufferChannel( pass, document.name, this.currentChannelIndex, true );
                            break;
                        }
                    }
                    else if( category === "texture" ) // Use this image as a texture
                    {
                        this.loadTextureChannelFromFile( fileId, this.currentChannelIndex );
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

    requestFullscreen( element ) {

        if( element == null ) element = document.documentElement;
        if( element.requestFullscreen ) element.requestFullscreen();
        else if( element.msRequestFullscreen ) element.msRequestFullscreen();
        else if( element.mozRequestFullScreen ) element.mozRequestFullScreen();
        else if( element.webkitRequestFullscreen ) element.webkitRequestFullscreen( Element.ALLOW_KEYBOARD_INPUT );

        if( element.focus ) element.focus();
    },

    isFullScreen() {
        return document.fullscreen || document.mozFullScreen || document.webkitIsFullScreen || document.msFullscreenElement;
    },

    exitFullscreen() {
        if( document.exitFullscreen ) document.exitFullscreen();
        else if( document.msExitFullscreen ) document.msExitFullscreen();
        else if( document.mozCancelFullScreen ) document.mozCancelFullScreen();
        else if( document.webkitExitFullscreen ) document.webkitExitFullscreen();
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

            const namePattern = LX.buildTextPattern( { minLength: Constants.USERNAME_MIN_LENGTH } );
            const passwordPattern = LX.buildTextPattern( { minLength: Constants.PASSWORD_MIN_LENGTH, digit: true } );
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
                    errorMsg.set( `❌ Name is too short. Please use at least ${ Constants.USERNAME_MIN_LENGTH } characters.` );
                    return;
                }
                else if( !( value.email.match( /^[^\s@]+@[^\s@]+\.[^\s@]+$/ ) ) )
                {
                    errorMsg.set( "❌ Please enter a valid email address." );
                    return;
                }
                else if( value.password.length < Constants.PASSWORD_MIN_LENGTH )
                {
                    errorMsg.set( `❌ Password is too short. Please use at least ${ Constants.PASSWORD_MIN_LENGTH } characters.` );
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

        const passName = this.editor.getSelectedTabName();
        if( passName === "Common" )
        {
            return;
        }

        const pass = this.shader.passes.find( p => p.name === passName );

        if( this._lastUniformsDialog )
        {
            this._lastUniformsDialog.close();
        }

        const dialog = new LX.Dialog( `Uniforms [${ pass.uniforms.length }]`, null, {
            modal: false, draggable: true, size: [ Math.min( 600, window.innerWidth - 64 ), "auto" ]
        } );

        // Put all the stuff in the dialog panel
        this.customParametersPanel.refresh( dialog.panel );

        const uniformsHeader = LX.makeContainer( ["auto", "auto"], "flex flex-row items-center", "", dialog.title );
        const addUniformButton = new LX.Button( null, "AddNewCustomUniform", () => {
            this.addUniform();
            this.customParametersPanel.refresh( dialog.panel, () => dialog.title.childNodes[ 0 ].textContent = `Uniforms [${ pass.uniforms.length }]` );
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

        // Upload file and get id
        const filename = `${ LX.toCamelCase( this.shader.name ) }.json`;
        const text = JSON.stringify( {
            name: this.shader.name,
            passes: this.shader.passes
        } );
        const arraybuffer = new TextEncoder().encode( text );
        const file = new File( [ arraybuffer ], filename, { type: "text/plain" });
        const result = await fs.createFile( file );
        return result[ "$id" ];
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
                    "description": this.shader.description,
                    "author_id": fs.getUserId(),
                    "author_name": this.shader.author ?? "",
                    "file_id": newFileId,
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

        // Delete old file first
        const fileId = shaderMetadata[ "file_id" ];
        await fs.deleteFile( fileId );

        const newFileId = await this.saveShaderFiles();

        // Update files reference in the DB
        await fs.updateDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid, {
            "name": this.shader.name,
            "description": this.shader.description,
            "file_id": newFileId,
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
            await fs.deleteFile( result[ "file_id" ] );

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
            "description": this.shader.description
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

        this.webGPUContext = canvas.getContext( 'webgpu' );

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

            for( let i = 0; i < this.shader.passes.length; ++i )
            {
                // Buffers and images draw
                const pass = this.shader.passes[ i ];
                if( pass.type === "common" ) continue;

                // Create uniform buffers if necessary
                for( let c = 0; c < pass.channels?.length ?? 0; ++c )
                {
                    const isCurrentPass = ( this.currentPass.name === pass.name );
                    const channelName = pass.channels[ c ];
                    if( !channelName || ( this.textures[ channelName ] ?? this.buffers[ channelName ] ) ) continue;

                    if( channelName === "Keyboard" )
                    {
                        await this.createKeyboardTexture( c, true );
                        continue;
                    }
                    else if( channelName.startsWith( "Buffer" ) )
                    {
                        await this.loadBufferChannel( pass, channelName, c, isCurrentPass )
                        continue;
                    }

                    // Only update preview in case that's the current pass
                    await this.createTexture( channelName, c, isCurrentPass );
                }

                if( this._parametersDirty && pass.uniforms.length )
                {
                    pass.uniforms.map( ( u, index ) => {
                        this.device.queue.writeBuffer(
                            pass.uniformBuffers[ index ],
                            0,
                            new Float32Array([ u.value ])
                        );
                    } );

                    this._parametersDirty = false;
                }

                if( !this._lastShaderCompilationWithErrors )
                {
                    if( !this.renderPipelines[ i ] )
                    {
                        await this.compileShader( true, pass );
                    }

                    const bg = await this.createRenderBindGroup( pass, this.renderPipelines[ i ] );

                    const r = pass.draw(
                        this.device,
                        this.webGPUContext,
                        this.renderPipelines[ i ],
                        bg,// this.renderBindGroups[ i ]
                    );

                    // Update buffers
                    if( pass.type === "buffer" )
                    {
                        this.buffers[ pass.name ] = r;
                    }
                }
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

            requestAnimationFrame( frame );
        }

        requestAnimationFrame( frame );
    },

    async createRenderPipeline( pass, updateBindGroup = true ) {

        const result = await this.validateShader( pass.getShaderCode() );
        if( !result.valid )
        {
            return result;
        }

        const renderPipeline = await this.device.createRenderPipeline({
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
            return [ renderPipeline, await this.createRenderBindGroup( pass, renderPipeline ) ];
        }
        else
        {
            return renderPipeline;
        }
    },

    async createRenderBindGroup( pass, renderPipeline ) {

        if( !renderPipeline )
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

        const customUniformCount = pass.uniforms.length;
        if( customUniformCount )
        {
            pass.uniforms.map( ( u, index ) => {
                const buffer = pass.uniformBuffers[ index ];
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

        const bindings = pass.channels.filter( u => u !== undefined && ( this.textures[ u ] || this.buffers[ u ] ) );

        if( bindings.length )
        {
            entries.push( ...pass.channels.map( ( channelName, index ) => {
                if( !channelName ) return;
                let texture = ( this.textures[ channelName ] ?? this.buffers[ channelName ] );
                if( !texture ) return;
                texture = ( texture instanceof Array ) ? texture[ Constants.BUFFER_PASS_BIND_TEXTURE_INDEX ] : texture;
                return { binding: bindingIndex++, resource: texture.createView() };
            } ).filter( u => u !== undefined ) );
            entries.push( { binding: bindingIndex++, resource: this.sampler } );
        }

        const renderBindGroup = await this.device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout( 0 ),
            entries
        });

        // console.warn( "Info: Render Bind Group created!" );

        return renderBindGroup;
    },

    async createTexture( fileId, channel, updatePreview = false, options = { } ) {

        if( !fileId )
        {
            return;
        }

        const url = await fs.getFileUrl( fileId );
        const data = await fs.requestFile( url );
        const imageBitmap = await createImageBitmap( await new Blob([data]) );
        const dimensions = [ imageBitmap.width, imageBitmap.height ];
        const imageTexture = this.device.createTexture({
            label: fileId,
            size: [ imageBitmap.width, imageBitmap.height, 1 ],
            format: 'rgba8unorm',
            usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap, ...options },
            { texture: imageTexture },
            dimensions
        );

        // const metadata = await fs.getFile( fileId );

        this.textures[ fileId ] = imageTexture;

        if( updatePreview )
        {
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
            label: "KeyboardTexture",
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

        // Recreate stuff if we update the texture and
        // a shader pass is using it
        const imageName = "Keyboard";
        this.textures[ imageName ] = imageTexture;

        for( const pass of this.shader.passes ?? [] )
        {
            const usedChannel = pass.channels.indexOf( imageName );

            if( ( channel === undefined ) && usedChannel > -1 )
            {
                channel = usedChannel;
            }

            if( channel !== undefined )
            {
                pass.channels[ channel ] = imageName;

                await this.compileShader( false, pass );

                if( updatePreview )
                {
                    this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = "images/keyboard.png";
                }
            }
        }
    },

    async validateShader( code ) {

        // Close all toasts
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );

        // Validate shader
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
                return { valid: false, code, messages: errorMsgs };
            }
        }

        return { valid: true, module };
    },

    _setEditorErrorBorder( errorCode = ERROR_CODE_DEFAULT ) {

        this.editor.area.root.parentElement.classList.toggle( "code-border-default", errorCode === ERROR_CODE_DEFAULT );
        this.editor.area.root.parentElement.classList.toggle( "code-border-error", errorCode === ERROR_CODE_ERROR );
        this.editor.area.root.parentElement.classList.toggle( "code-border-success", errorCode === ERROR_CODE_SUCCESS );

        LX.doAsync( () => this._setEditorErrorBorder(), 2000 );
    },

    async compileShader( showFeedback = true, pass ) {

        this._lastShaderCompilationWithErrors = false;

        this.editor.processLines();

        const tabs = this.editor.tabs.tabs;
        const compilePasses = pass ? [ pass ] : this.shader.passes;

        for( let i = 0; i < compilePasses.length; ++i )
        {
            // Buffers and images draw
            const pass = compilePasses[ i ];
            pass.codeLines = tabs[ pass.name ].lines;
            console.assert( pass.codeLines, `No tab with name ${ pass.name }` );
            if( pass.type === "common" ) continue;

            const passIndex = this.shader.passes.indexOf( pass );
            const pipeline = await this.createRenderPipeline( pass, false );
            if( pipeline.constructor === GPURenderPipeline ) // success, no errors
            {
                this.renderPipelines[ passIndex ] = pipeline;
                this.renderBindGroups[ passIndex ] = await this.createRenderBindGroup( pass, pipeline );
            }
            else
            {
                // Open the tab with the error
                this.editor.loadTab( pass.name );

                // Make async so the tab is opened before adding the error feedback
                LX.doAsync( () => {

                    const mainImageLineOffset = pipeline.code.split( "\n" ).indexOf( pass.codeLines[ 0 ] );
                    console.assert( mainImageLineOffset > 0 );

                    for( const msg of pipeline.messages )
                    {
                        const fragLineNumber = msg.lineNum - ( mainImageLineOffset );

                        if( showFeedback )
                        {
                            this._setEditorErrorBorder( ERROR_CODE_ERROR );
                            LX.toast( `❌ ${ LX.toTitleCase( msg.type ) }: ${ fragLineNumber }:${ msg.linePos }`, msg.message, { timeout: -1, position: "top-right" } );
                            this.editor.code.childNodes[ fragLineNumber - 1 ]?.classList.add( msg.type === "error" ? "removed" : "debug");
                        }
                    }
                }, 10 );

                this._lastShaderCompilationWithErrors = true;

                return WEBGPU_ERROR; // Stop at first error
            }
        }

        if( showFeedback )
        {
            this._setEditorErrorBorder( ERROR_CODE_SUCCESS );
            // LX.toast( `✅ No errors`, "Shader compiled successfully!", { position: "top-right" } );
        }

        return WEBGPU_OK;
    },

    async shaderExists() {
        try {
            return await fs.getDocument( FS.SHADERS_COLLECTION_ID, this.shader.uid );
        } catch (error) {
            // Doesn't exist...
        }
    },

    async loadBufferChannel( pass, bufferName, channel, updatePreview = false, forceCompile = false ) {

        pass.channels[ channel ] = bufferName;

        if( forceCompile )
        {
            await this.compileShader( true, pass );
        }

        if( updatePreview )
        {
            this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = "images/buffer.png";
        }
    },

    async loadTextureChannelFromFile( file, channel ) {

        const pass = this.currentPass;
        if( pass.name === "Common" )
        {
            return;
        }

        pass.channels[ channel ] = file;
        await this.createTexture( file, channel, true );

        this.compileShader( true, pass );
    },

    async removeUniformChannel( channel ) {

        const pass = this.currentPass;
        if( pass.name === "Common" )
        {
            return;
        }

        pass.channels[ channel ] = undefined;

        // Reset image
        this.channelsContainer.childNodes[ channel ].querySelector( "img" ).src = Constants.IMAGE_EMPTY_SRC;

        // Recreate everything
        this.compileShader( true, pass );
    },

    async addUniform( name, value, min, max ) {

        const passName = this.editor.getSelectedTabName();
        if( passName === "Common" )
        {
            return;
        }

        const pass = this.shader.passes.find( p => p.name === passName );
        const uName = name ?? `iUniform${ pass.uniforms.length + 1 }`;
        pass.uniforms.push( { name: uName, value: value ?? 0, min: min ?? 0, max: max ?? 1 } );
        const allCode = pass.getShaderCode( false );
        if( allCode.match( new RegExp( `\\b${ uName }\\b` ) ) )
        {
            this.createRenderPipeline( true );
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
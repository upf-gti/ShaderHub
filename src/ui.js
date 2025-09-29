import { LX } from 'lexgui';
// import 'lexgui/extensions/codeeditor.js';
import 'lexgui/extensions/docmaker.js';
import './extra/codeeditor.js';
import * as Constants from "./constants.js";
import * as Utils from './utils.js';
import { FS } from './fs.js';
import { ShaderHub } from './app.js';

const Query = Appwrite.Query;
const mobile = Utils.isMobile();

export const ui = {

    imageCache: {},

    allowCapture: true,

    async init( fs )
    {
        this.fs = fs;
        this.area = await LX.init();
        // this.area.root.classList.add( "hub-background" );

        const starterTheme = LX.getTheme();

        const r = document.querySelector( ':root' );
        r.style.setProperty( "--hub-background-image", `url("images/background${ starterTheme === "dark" ? "" : "_inverted" }.png")` );

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
                    name: "New", callback: () => ShaderHub.openShader( "new" )
                },
                {
                    name: "Browse", callback: () => ShaderHub.openBrowseList()
                },
                {
                    name: "Help", callback: () => ShaderHub.openHelp()
                }
            );
        }

        const menubar = this.area.addMenubar( menubarOptions, { parentClass: "bg-none" } );

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
                    m.add( "Profile", { icon: "User", callback: () => ShaderHub.openProfile( fs.getUserId() ) } );
                    m.add( "Liked Shaders", { icon: "Heart", callback: () => ShaderHub.openProfileLikes( fs.getUserId() ) } );
                    m.add( "Browse", { icon: "Search", callback: () => ShaderHub.openBrowseList() } );
                    m.add( "Help", { icon: "HelpCircle", callback: () => ShaderHub.openHelp() } );
                    m.add( "Logout", { icon: "LogOut", callback: async () => {
                        await this.onLogout();
                    } } );
                }
                else
                {
                    m.add( "Login", { icon: "LogIn", callback: () => this.openLoginDialog() } );
                    m.add( "Create account", { icon: "UserPlus", callback: () => this.openSignUpDialog() } );
                }
            }

            const sheetArea = new LX.Area({ skipAppend: true });
            sheetArea.addSidebar( sidebarCallback, sidebarOptions );

            menubar.addButtons( menubarButtons );

            menubar.setButtonIcon( "Menu", "Menu", () => window.__currentSheet = new LX.Sheet("256px", [ sheetArea ], { side: "right" } ) );
        }
        else
        {
            menubar.addButtons( menubarButtons );

            const signupContainer = LX.makeContainer( [`auto`, "auto"], "flex flex-row p-1 gap-1 self-center items-center", "", menubar.root );
            signupContainer.id = "signupContainer";
            signupContainer.classList.toggle( "hidden", !!fs.user );
            const signupOptionsButton = LX.makeContainer( [`auto`, "auto"], "p-1 rounded-lg fg-primary hover:bg-tertiary text-md self-center items-center cursor-pointer", "Create account", signupContainer );
            signupOptionsButton.addEventListener( "click", async (e) => {
                e.preventDefault();
                this.openSignUpDialog();
            } );
            LX.makeContainer( [`auto`, "0.75rem"], "mx-2 border-right border-colored fg-quaternary self-center items-center", "", signupContainer );

            this.getLoginHtml = ( user ) => {
                return ( !user ) ? "Login" :
                `<span class="decoration-none fg-secondary">${ user.email }</span>
                    <span class="ml-1 rounded-full w-6 h-6 bg-accent text-center leading-tight content-center">${ user.name[ 0 ].toUpperCase() }</span>
                    ${ LX.makeIcon("ChevronsUpDown", { iconClass: "pl-2" } ).innerHTML }`;
            };

            const loginOptionsButton = LX.makeContainer( [`auto`, "auto"], "flex flex-row gap-1 p-1 mr-2 rounded-lg fg-primary hover:bg-tertiary text-md self-center items-center cursor-pointer", `
                ${ this.getLoginHtml( fs.user ) }`, menubar.root );
            loginOptionsButton.id = "loginOptionsButton";
            loginOptionsButton.addEventListener( "click", async (e) => {
                e.preventDefault();
                if( fs.user )
                {
                    new LX.DropdownMenu( loginOptionsButton, [
                        fs.user.name,
                        null,
                        { name: "Profile", icon: "User", callback: () => ShaderHub.openProfile( fs.getUserId() ) },
                        { name: "Liked Shaders", icon: "Heart", callback: () => ShaderHub.openProfileLikes( fs.getUserId() ) },
                        { name: "Logout", icon: "LogOut", className: "fg-error", callback: async () => {
                            await this.onLogout();
                        } },
                    ], { side: "bottom", align: "end" });
                }
                else
                {
                    this.openLoginDialog();
                }
            } );
        }

        menubar.setButtonImage("ShaderHub", `images/icon_${ starterTheme }.png`, () => {
            const needsReload = window.location.search === "";
            window.location.hash = "";
            window.location.href = ShaderHub.getFullPath();
            if( needsReload ) window.location.reload();
        }, { float: "left" } );

        LX.addSignal( "@on_new_color_scheme", ( el, value ) => {
            menubar.setButtonImage("ShaderHub", `images/icon_${ value }.png`, null, { float: "left" } );
            r.style.setProperty( "--hub-background-image", `url("images/background${ value === "dark" ? "" : "_inverted" }.png")` );
        } );

        menubar.root.classList.add( "hub-background-blur-md" );

        const params = new URLSearchParams( document.location.search );
        const queryShader = params.get( "shader" );
        const queryProfile = params.get( "profile" );
        const queryLikes = params.get( "show_likes" );

        if( queryShader )
        {
            await this.makeShaderView( queryShader );
        }
        else if( queryProfile )
        {
            await this.makeProfileView( queryProfile, queryLikes );
        }
        else
        {
            const hash = window.location.hash ?? "";
            if( hash === "#browse" )
            {
                this.makeBrowseList();
                return;
            }
            else if( hash === "#help" )
            {
                this.makeHelpView();
                return;
            }

            await this.makeInitialPage();
        }
    },

    async makeInitialPage()
    {
        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", "48px"], resize: false });
        this.area.root.className += " hub-background";
        bottomArea.root.className += " items-center content-center";
        topArea.root.className += " flex flex-row hub-background-blur content-area";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 self-center text-center align-center ml-auto mr-auto", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea );

        let leftSide = LX.makeContainer( ["auto", "100%"], "bg-none flex flex-col p-8 gap-2 overflow-scroll", "", topArea );
        leftSide.style.minWidth = "50%";
        let rightSide = LX.makeContainer( ["100%", "100%"], "bg-none flex flex-col p-8 place-content-center items-center", "", topArea );

        // Create title/login area
        {
            const container = LX.makeContainer( ["100%", "100%"], "bg-blur flex flex-col gap-8 rounded-lg box-shadow box-border place-content-center items-center overflow-scroll", "", rightSide );
            const header = LX.makeContainer( [ null, "auto" ], "flex flex-col mt-8 px-12 gap-4 text-center items-center place-content-center", `
                <h2 class="fg-secondary">ShaderHub beta</h2>
                <h1 style="font-size: 3rem">Create and Share Shaders<br> using latest WebGPU!</h1>
            `, container );

            if( !mobile )
            {
                const headerButtons = LX.makeContainer( [ "auto", "auto" ], "flex flex-row p-2", ``, header );
                const getStartedButton = new LX.Button( null, "Create a Shader", () => ShaderHub.openShader( "new" ), { icon: "ChevronRight", iconPosition: "end", buttonClass: "fg-primary box-border text-xl p-2 px-4" } );
                headerButtons.appendChild( getStartedButton.root );
            }

            if( !this.fs.user )
            {
                const loginContainer = LX.makeContainer( ["90%", "auto"], "xl:w-1/2 flex flex-col gap-2 p-6 text-center fg-secondary", "Sign in to save your shaders:", container );
                const formData = { email: { label: "Email", value: "", icon: "AtSign" }, password: { label: "Password", icon: "Key", value: "", type: "password" } };
                const form = new LX.Form( null, formData, async (value, event) => {
                    await this.fs.login( value.email, value.password, async ( user, session ) => {
                        await this.onLogin( user );
                        ShaderHub.openBrowseList();
                    }, (err) => {
                        Utils.toast( `❌ Error`, err, -1 );
                    } );
                }, { primaryActionName: "Login" });
                loginContainer.appendChild( form.root );
            }
            else
            {
                LX.makeContainer( ["100%", "auto"], "p-8 text-center text-xxl fg-secondary", `Welcome ${ this.fs.user.name }!`, container );
            }
        }

        let skeletonHtml = "";

        for( let i = 0; i < 3; ++i )
        {
            const shaderItem = LX.makeElement( "li", `shader-item ${ i === 0 ? "featured" : "" } lexskeletonpart relative rounded-lg bg-blur hover:bg-tertiary overflow-hidden flex flex-col h-auto`, "" );
            const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-t-lg bg-blur hover:bg-tertiary border-none cursor-pointer self-center mt-1", "", shaderItem );
            shaderPreview.style.width = "calc(100% - 0.5rem)";
            shaderPreview.style.height = "calc(100% - 0.5rem)";
            shaderPreview.src = "images/shader_preview.png";
            LX.makeContainer( ["100%", "auto"], "bg-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                <div class="w-full flex flex-col gap-1">
                    <div class="w-3/4 h-3 lexskeletonpart"></div>
                    <div class="w-1/2 h-3 lexskeletonpart"></div>
                </div>`, shaderItem );

            skeletonHtml += shaderItem.outerHTML;
        }

        LX.makeContainer( ["100%", "auto"], "font-medium fg-secondary", `Featured Shaders`, leftSide, { fontSize: "2rem" } );

        const skeleton = new LX.Skeleton( skeletonHtml );
        skeleton.root.classList.add( "grid", "shader-list-initial", "gap-8", "justify-center" );
        leftSide.appendChild( skeleton.root );

        LX.doAsync( async () => {

            // Get all stored shader files (not the code, only the data)
            const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, [ Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ) ] );
            const dbShaders = result.documents.sort( (a, b) => ( b[ "like_count" ] ?? 0 ) - ( a[ "like_count" ] ?? 0 ) ).slice( 0, 3 );

            let shaderList = [];

            for( const document of dbShaders )
            {
                const name = document.name;

                const shaderInfo = {
                    name,
                    uid: document[ "$id" ],
                    creationDate: Utils.toESDate( document[ "$createdAt" ] ),
                    likeCount: document[ "like_count" ] ?? 0
                };

                const authorId = document[ "author_id" ];
                if( authorId )
                {
                    const r = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorId ) ] );
                    const author = r.documents[ 0 ][ "user_name" ];
                    shaderInfo.author = author;
                    shaderInfo.authorId = authorId;
                }
                else
                {
                    shaderInfo.author = document[ "author_name" ];
                    shaderInfo.anonAuthor = true;
                }

                {
                    const previewName = `${ shaderInfo.uid }.png`;
                    const r = await this.fs.listFiles( [ Query.equal( "name", previewName ) ] );
                    if( r.total > 0 )
                    {
                        shaderInfo.preview = await this.fs.getFileUrl( r.files[ 0 ][ "$id" ] );
                    }
                }

                shaderList.push( shaderInfo );
            }

            // Instead of destroying it, convert to normal container
            skeleton.root.querySelectorAll( ".lexskeletonpart" ).forEach( i => i.classList.remove( "lexskeletonpart" ) );

            for( let i = 0; i < shaderList.length; ++i )
            {
                const shader = shaderList[ i ];
                const shaderItem = skeleton.root.children[ i ];
                const shaderPreview = shaderItem.querySelector( "img" );
                shaderPreview.style.width = "calc(100% - 0.5rem)";
                shaderPreview.src = shader.preview ?? "images/shader_preview.png";
                shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                shaderItem.querySelector( "div" ).remove();
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                    <div class="w-full">
                        <div class="text-md font-bold">${ shader.name }</div>
                        <div class="text-sm font-light">by ${ !shader.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shader.authorId }")' class='dodgerblue cursor-pointer hover:text-underline'>` : "" }<span class="font-bold">${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" }</div>
                    </div>
                    <div class="flex flex-row gap-1 items-center">
                        ${ LX.makeIcon( "Heart", { svgClass: "fill-current fg-secondary" } ).innerHTML }
                        <span>${ shader.likeCount ?? 0 }</span>
                    </div>`, shaderItem );

                shaderPreview.addEventListener( "click", ( e ) => {
                    ShaderHub.openShader( shader.uid );
                } );
            }

            if( shaderList.length === 0 )
            {
                skeleton.root.innerHTML = "";
                LX.makeContainer( ["100%", "auto"], "text-xxl font-medium justify-center text-center", "No shaders found.", skeleton.root );
            }

        }, 10 );
    },

    async makeBrowseList()
    {
        const params = new URLSearchParams( document.location.search );
        const queryFeature = params.get( "feature" );

        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.parentElement.classList.add( "hub-background" )
        topArea.root.className += " p-6 overflow-scroll hub-background-blur";
        bottomArea.root.className += " hub-background-blur-md items-center content-center";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 self-center text-center align-center ml-auto mr-auto", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea );

        // Filters
        {
            const iBrowseFeature = (v) => {
                window.location.href = `${ ShaderHub.getFullPath() }?feature=${ v }#browse`;
            };

            LX.makeContainer( ["100%", "auto"], "font-medium fg-secondary", ``, topArea, { fontSize: "2rem" } );
            const filtersPanel = new LX.Panel( { className: "p-4 bg-none", height: "auto" } );
            filtersPanel.sameLine();

            for( let f of Constants.FEATURES )
            {
                const fLower = f.toLowerCase();
                filtersPanel.addButton( null, f, (v) => iBrowseFeature( v.toLowerCase() ), { buttonClass: queryFeature === fLower ? "contrast" : "tertiary" } );
            }

            filtersPanel.endLine();
            topArea.attach( filtersPanel );
        }

        // Get all stored shader files (not the code, only the data)
        const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, [ Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ) ] );
        const dbShaders = result.documents.filter( (d) => {
            if( !queryFeature ) return true;
            return ( d[ "features" ] ?? "" ).split( "," ).includes( queryFeature );
        } );

        if( dbShaders.length === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
        }

        let skeletonHtml = "";

        for( let i = 0; i < dbShaders.length; ++i )
        {
            const shaderItem = LX.makeElement( "li", `shader-item lexskeletonpart relative rounded-lg bg-blur hover:bg-tertiary overflow-hidden flex flex-col h-auto`, "" );
            const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-t-lg bg-blur hover:bg-tertiary border-none cursor-pointer self-center mt-1", "", shaderItem );
            shaderPreview.style.width = "calc(100% - 0.5rem)";
            shaderPreview.style.height = "calc(100% - 0.5rem)";
            shaderPreview.src = "images/shader_preview.png";
            LX.makeContainer( ["100%", "auto"], "absolute bottom-0 bg-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                <div class="w-full flex flex-col gap-1">
                    <div class="w-3/4 h-3 lexskeletonpart"></div>
                    <div class="w-1/2 h-3 lexskeletonpart"></div>
                </div>`, shaderItem );

            skeletonHtml += shaderItem.outerHTML;
        }

        const skeleton = new LX.Skeleton( skeletonHtml );
        skeleton.root.classList.add( "grid", "shader-list", "gap-6", "justify-center" );
        topArea.attach( skeleton.root );

        LX.doAsync( async () => {

            let shaderList = [];

            for( const document of dbShaders )
            {
                const name = document.name;

                const shaderInfo = {
                    name,
                    uid: document[ "$id" ],
                    creationDate: Utils.toESDate( document[ "$createdAt" ] ),
                    likeCount: document[ "like_count" ],
                    features: ( document[ "features" ] ?? "" ).split( "," ),
                    public: document[ "public" ] ?? true
                };

                if( queryFeature && !shaderInfo.features.includes( queryFeature ) )
                {
                    continue;
                }

                const authorId = document[ "author_id" ];
                if( authorId )
                {
                    const r = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorId ) ] );
                    const author = r.documents[ 0 ][ "user_name" ];
                    shaderInfo.author = author;
                    shaderInfo.authorId = authorId;
                }
                else
                {
                    shaderInfo.author = document[ "author_name" ];
                    shaderInfo.anonAuthor = true;
                }

                const previewName = `${ shaderInfo.uid }.png`;
                const r = await this.fs.listFiles( [ Query.equal( "name", previewName ) ] );
                if( r.total > 0 )
                {
                    shaderInfo.preview = await this.fs.getFileUrl( r.files[ 0 ][ "$id" ] );
                }

                shaderList.push( shaderInfo );
            }

            shaderList = shaderList.sort( (a, b) => a.name.localeCompare( b.name ) );

            // Instead of destroying it, convert to normal container
            skeleton.root.querySelectorAll( ".lexskeletonpart" ).forEach( i => i.classList.remove( "lexskeletonpart" ) );

            for( let i = 0; i < shaderList.length; ++i )
            {
                const shader = shaderList[ i ];
                const shaderItem = skeleton.root.children[ i ];
                const shaderPreview = shaderItem.querySelector( "img" );
                shaderPreview.style.width = "calc(100% - 0.5rem)";
                shaderPreview.src = shader.preview ?? "images/shader_preview.png";
                shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                shaderItem.querySelector( "div" ).remove();
                const shaderDesc = LX.makeContainer( ["100%", "100%"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                    <div class="w-full">
                        <div class="text-lg font-bold">${ shader.name }</div>
                        <div class="text-sm font-light">by ${ !shader.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shader.authorId }")' class='dodgerblue cursor-pointer hover:text-underline'>` : "" }<span class="font-bold">${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" }</div>
                    </div>
                    <div class="flex flex-row gap-1">
                        ${ LX.makeIcon( "Heart", { svgClass: "fill-current fg-secondary" } ).innerHTML }
                        <span>${ shader.likeCount ?? 0 }</span>
                    </div>`, shaderItem );

                shaderPreview.addEventListener( "click", ( e ) => {
                    ShaderHub.openShader( shader.uid );
                } );
            }

            this.shaderList = shaderList;
        }, 10 );
    },

    async makeProfileView( userID, showLikes )
    {
        let [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.parentElement.classList.add( "hub-background" )
        topArea.root.className += " p-6 hub-background-blur overflow-scroll";
        bottomArea.root.className += " items-center content-center";

        // Shaderhub footer
        LX.makeContainer( [`auto`, "auto"], "fg-primary text-lg flex flex-row gap-2 self-center text-center align-center ml-auto mr-auto", `
            ${ LX.makeIcon("Github@solid", {svgClass:"lg"} ).innerHTML }<a class="decoration-none fg-secondary" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, bottomArea );

        const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", userID ) ] );
        if( users.total === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No user found.", topArea );
            return;
        }

        const user = users.documents[ 0 ];
        const userName = user[ "user_name" ];

        // Likes are only shown for the active user, they are private!
        const ownProfile = this.fs.user && ( userID === this.fs.getUserId() );
        showLikes = JSON.parse( showLikes ) && ownProfile;

        // Show profile
        if( !showLikes )
        {
            document.title = `${ userName } - ShaderHub`;

            const infoContainer = LX.makeContainer( ["100%", "auto"], "flex flex-col gap-2 p-2 my-8 justify-center", `
                <div style="font-size: 2.5rem" class="font-bold">@${ userName }</div>
                <div class="flex flex-row gap-2">
                    <div class="w-auto self-start mt-1">${ ownProfile ? LX.makeIcon("Edit", { svgClass: "mr-3 cursor-pointer hover:fg-primary" } ).innerHTML : "" }</div>
                    <div style="font-size: 1.25rem; max-width: 600px; overflow-wrap: break-word;" class="desc-content font-medium fg-secondary">${ user[ "description" ] ?? "" }</div>
                </div>
            `, topArea );

            const editButton = infoContainer.querySelector( "svg" );
            if( editButton )
            {
                editButton.addEventListener( "click", (e) => {
                    if( this._editingDescription ) return;
                    e.preventDefault();
                    const text = infoContainer.querySelector( ".desc-content" );
                    const input = new LX.TextArea( null, text.innerHTML, async (v) => {
                        text.innerHTML = v;
                        input.root.replaceWith( text );
                        await this.fs.updateDocument( FS.USERS_COLLECTION_ID, user[ "$id" ], {
                            "description": v
                        } );
                        this._editingDescription = false;
                    }, { width: "600px", resize: false, placeholder: "Enter your description here", className: "h-full", inputClass: "text-xl font-medium fg-secondary bg-tertiary", fitHeight: true } );
                    text.replaceWith( input.root );
                    LX.doAsync( () => input.root.focus() );
                    this._editingDescription = true;
                } );
            }

            const queries = [
                Query.equal( "author_id", userID ),
            ];

            if( !ownProfile )
            {
                queries.push( Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ) );
            }

            const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, queries );

            if( result.total === 0 )
            {
                LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
                return;
            }

            let skeletonHtml = "";

            for( let i = 0; i < result.total; ++i )
            {
                const shaderItem = LX.makeElement( "li", `shader-item lexskeletonpart relative rounded-lg bg-blur hover:bg-tertiary overflow-hidden flex flex-col h-auto`, "" );
                const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-t-lg bg-blur hover:bg-tertiary border-none cursor-pointer self-center mt-1", "", shaderItem );
                shaderPreview.style.width = "calc(100% - 0.5rem)";
                shaderPreview.style.height = "calc(100% - 0.5rem)";
                shaderPreview.src = "images/shader_preview.png";
                LX.makeContainer( ["100%", "auto"], "absolute bottom-0 bg-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                    <div class="w-full flex flex-col gap-1">
                        <div class="w-3/4 h-3 lexskeletonpart"></div>
                        <div class="w-1/2 h-3 lexskeletonpart"></div>
                    </div>`, shaderItem );

                skeletonHtml += shaderItem.outerHTML;
            }

            const skeleton = new LX.Skeleton( skeletonHtml );
            skeleton.root.classList.add( "grid", "shader-list", "gap-6", "justify-center" );
            topArea.attach( skeleton.root );

            LX.doAsync( async () => {

                // Instead of destroying it, convert to normal container
                skeleton.root.querySelectorAll( ".lexskeletonpart" ).forEach( i => i.classList.remove( "lexskeletonpart" ) );

                result.documents = result.documents.sort( (a, b) => a.name.localeCompare( b.name ) );

                for( let i = 0; i < result.total; ++i )
                {
                    const document = result.documents[ i ];
                    const uid = document[ "$id" ];
                    const name = document.name;

                    const shaderInfo = {
                        name,
                        uid,
                        likeCount: document[ "like_count" ] ?? 0,
                        public: document[ "public" ] ?? true,
                        url: await this.fs.getFileUrl( document[ "file_id" ] ),
                    };

                    const previewName = `${ shaderInfo.uid }.png`;
                    const r = await this.fs.listFiles( [ Query.equal( "name", previewName ) ] );
                    if( r.total > 0 )
                    {
                        shaderInfo.preview = await this.fs.getFileUrl( r.files[ 0 ][ "$id" ] );
                    }

                    const shaderItem = skeleton.root.children[ i ];
                    const shaderPreview = shaderItem.querySelector( "img" );
                    shaderPreview.style.width = "calc(100% - 0.5rem)";
                    shaderPreview.src = shaderInfo.preview ?? "images/shader_preview.png";
                    shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                    shaderItem.querySelector( "div" ).remove();
                    const shaderDesc = LX.makeContainer( ["100%", "100%"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                        <div class="w-full">
                            <div class="text-lg font-bold"><span>${ shaderInfo.name }</span></div>
                        </div>
                        <div class="flex flex-row gap-2 items-center">
                            ${ ownProfile ? LX.makeIcon( shaderInfo.public ? "Eye" : "EyeOff", { svgClass: "viz-icon fg-secondary" } ).innerHTML : "" }
                            <div class="flex flex-row gap-1 items-center">
                                ${ LX.makeIcon( "Heart", { svgClass: "fill-current fg-secondary" } ).innerHTML }
                                <span>${ shaderInfo.likeCount ?? 0 }</span>
                            </div>
                            ${ ownProfile ? `<span class="h-3 mx-2 border-right border-colored fg-quaternary self-center items-center"></span>` : "" }
                            ${ ownProfile ? LX.makeIcon( "EllipsisVertical", { svgClass: "shader-prof-opt fg-secondary cursor-pointer" } ).innerHTML : "" }
                        </div>`, shaderItem );

                    let vizIcon = shaderDesc.querySelector( ".viz-icon" );
                    const optButton = shaderDesc.querySelector( ".shader-prof-opt" );
                    if( optButton )
                    {
                        optButton.addEventListener( "click", ( e ) => {
                            new LX.DropdownMenu( optButton, [
                                { name: shaderInfo.public ? "Make Private" : "Make Public", icon: shaderInfo.public ? "EyeOff" : "Eye", callback: async () => {
                                    shaderInfo.public = !shaderInfo.public;
                                    const newIcon = LX.makeIcon( shaderInfo.public ? "Eye" : "EyeOff", { svgClass: "viz-icon fg-secondary" } ).querySelector( "svg" );
                                    vizIcon.replaceWith( newIcon );
                                    vizIcon = newIcon;
                                    await this.fs.updateDocument( FS.SHADERS_COLLECTION_ID, uid, {
                                        "public": shaderInfo.public,
                                    } );
                                } },
                                { name: "Export", icon: "Download", callback: async () => {
                                    const json = JSON.parse( await this.fs.requestFile( shaderInfo.url, "text" ) );
                                    const code = json.passes.map( (p, i) => {
                                        const lines = [];
                                        if( i !== 0 ) lines.push( "" );
                                        lines.push( `// ${ p.name }`, "", ...p.codeLines );
                                        return lines.join( "\n" );
                                    } ).join( "\n" );
                                    LX.downloadFile( `${ shaderInfo.name.replaceAll( " ", "" ) }.wgsl`, code );
                                } },
                                null,
                                { name: "Delete", icon: "Trash2", className: "fg-error", callback: () => ShaderHub.deleteShader( { uid, name } ) },
                            ], { side: "bottom", align: "end" });
                        } );
                    }

                    shaderPreview.addEventListener( "click", ( e ) => {
                        ShaderHub.openShader( shaderInfo.uid );
                    } );
                }
            }, 10 );
        }
        // Show liked shaders
        else
        {
            document.title = `${ userName } Likes - ShaderHub`;

            const queries = [
                Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ),
            ];

            const likes = user[ "liked_shaders" ];
            const qOrs = [];
            likes.forEach( l => {
                qOrs.push( Query.equal( "$id", l ) );
            } )

            if( qOrs.length )
            {
                queries.push( qOrs.length === 1 ? qOrs[ 0 ] : Query.or( qOrs ) );
            }

            const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, queries );

            if( result.total === 0 )
            {
                LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No shaders found.", topArea );
                return;
            }

            const infoContainer = LX.makeContainer( ["100%", "auto"], "flex flex-col gap-2 p-2 my-8 justify-center", `
                <div style="font-size: 2.5rem" class="font-bold">${ result.total } Liked Shaders</div>
                <div style="font-size: 1rem;" class="font-medium fg-secondary">Order: Most recent</div>
            `, topArea );

            let skeletonHtml = "";

            for( let i = 0; i < result.total; ++i )
            {
                const shaderItem = LX.makeElement( "li", `shader-item lexskeletonpart relative rounded-lg bg-blur hover:bg-tertiary overflow-hidden flex flex-col h-auto`, "" );
                const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-t-lg bg-blur hover:bg-tertiary border-none cursor-pointer self-center mt-1", "", shaderItem );
                shaderPreview.style.width = "calc(100% - 0.5rem)";
                shaderPreview.style.height = "calc(100% - 0.5rem)";
                shaderPreview.src = "images/shader_preview.png";
                LX.makeContainer( ["100%", "auto"], "absolute bottom-0 bg-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                    <div class="w-full flex flex-col gap-1">
                        <div class="w-3/4 h-3 lexskeletonpart"></div>
                        <div class="w-1/2 h-3 lexskeletonpart"></div>
                    </div>`, shaderItem );

                skeletonHtml += shaderItem.outerHTML;
            }

            const skeleton = new LX.Skeleton( skeletonHtml );
            skeleton.root.classList.add( "grid", "shader-list", "gap-6", "justify-center" );
            topArea.attach( skeleton.root );

            LX.doAsync( async () => {

                // Instead of destroying it, convert to normal container
                skeleton.root.querySelectorAll( ".lexskeletonpart" ).forEach( i => i.classList.remove( "lexskeletonpart" ) );

                const indexMap = new Map( likes.map( ( id, i ) => [ id, i ] ) );
                result.documents = result.documents.sort( ( a, b ) => indexMap.get( a ) - indexMap.get( b ) ).reverse();

                for( let i = 0; i < result.total; ++i )
                {
                    const document = result.documents[ i ];
                    const name = document.name;

                    const shaderInfo = {
                        name,
                        uid: document[ "$id" ],
                        likeCount: document[ "like_count" ] ?? 0,
                    };

                    const authorId = document[ "author_id" ];
                    if( authorId )
                    {
                        const r = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorId ) ] );
                        const author = r.documents[ 0 ][ "user_name" ];
                        shaderInfo.author = author;
                        shaderInfo.authorId = authorId;
                    }
                    else
                    {
                        shaderInfo.author = document[ "author_name" ];
                        shaderInfo.anonAuthor = true;
                    }

                    const previewName = `${ shaderInfo.uid }.png`;
                    const r = await this.fs.listFiles( [ Query.equal( "name", previewName ) ] );
                    if( r.total > 0 )
                    {
                        shaderInfo.preview = await this.fs.getFileUrl( r.files[ 0 ][ "$id" ] );
                    }

                    const shaderItem = skeleton.root.children[ i ];
                    const shaderPreview = shaderItem.querySelector( "img" );
                    shaderPreview.style.width = "calc(100% - 0.5rem)";
                    shaderPreview.src = shaderInfo.preview ?? "images/shader_preview.png";
                    shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                    shaderItem.querySelector( "div" ).remove();
                    const shaderDesc = LX.makeContainer( ["100%", "100%"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                        <div class="w-full">
                            <div class="text-lg font-bold"><span>${ shaderInfo.name }</span></div>
                            <div class="text-sm font-light">by ${ !shaderInfo.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shaderInfo.authorId }")' class='dodgerblue cursor-pointer hover:text-underline'>` : "" }<span class="font-bold">${ shaderInfo.author }</span>${ !shaderInfo.anonAuthor ? "</a>" : "" }</div>
                        </div>
                        <div class="flex flex-row gap-1 items-center">
                            ${ LX.makeIcon( "Heart", { svgClass: "fill-current fg-secondary" } ).innerHTML }
                            <span>${ shaderInfo.likeCount ?? 0 }</span>
                        </div>`, shaderItem );

                    shaderPreview.addEventListener( "click", ( e ) => {
                        ShaderHub.openShader( shaderInfo.uid );
                    } );
                }
            }, 10 );
        }

    },

    async makeShaderView( shaderUid )
    {
        this.area.root.style.height = "100dvh";

        const shader = await ShaderHub.getShaderById( shaderUid );
        const isNewShader = ( shaderUid === "new" );
        this.shader = shader;

        let [ leftArea, rightArea ] = this.area.split({ sizes: ["50%", "50%"] });
        rightArea.root.className += " bg-none p-3 shader-edit-content";
        leftArea.root.className += " bg-none p-3 flex flex-col gap-2";

        // Set background to parent area
        this.area.root.parentElement.classList.add( "hub-background" );
        leftArea.root.parentElement.classList.add( "hub-background-blur" );

        let [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", "20%"], resize: false });
        codeArea.root.className += " box-shadow rounded-lg overflow-hidden code-border-default";
        shaderSettingsArea.root.className += " bg-none content-center";

        this.channelsContainer = LX.makeContainer( ["100%", "100%"], "channel-list grid gap-2 pt-2 items-center justify-center", "", shaderSettingsArea );

        document.title = `${ shader.name } (${ shader.author }) - ShaderHub`;

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

        const iCompileShader = async () => {
            const error = await ShaderHub.compileShader( true, null, false, true );
            if( error === 0 && !window.onbeforeunload )
            {
                window.onbeforeunload = ( event ) => {
                    event.preventDefault();
                    event.returnValue = "";
                };
            }
        };

        this.editor = await new LX.CodeEditor( codeArea, {
            allowClosingTabs: false,
            allowLoadingFiles: false,
            fileExplorer: false,
            defaultTab: false,
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            customSuggestions,
            onCreateStatusPanel: this.makeStatusBarButtons.bind( this ),
            onCtrlSpace: iCompileShader.bind( this ),
            onSave: iCompileShader.bind( this ),
            onRun: iCompileShader.bind( this ),
            onCreateFile: ( editor ) => null,
            onContextMenu: ( editor, content, event ) => {
                const pass = ShaderHub.currentPass;
                if( pass.name === "Common" ) return;

                const word = content.trim().match( /([A-Za-z0-9_]+)/g )[ 0 ];
                if( !word ) return;

                const options = [];
                const USED_UNIFORM_NAMES = [ ...Constants.DEFAULT_UNIFORM_NAMES, ...pass.uniforms.map( u => u.name ) ];
                const regex = new RegExp( "\\b(?!(" + USED_UNIFORM_NAMES.join("|") + ")\\b)(i[A-Z]\\w*)\\b" );

                options.push( { path: "Create Uniform", disabled: !regex.test( word ), callback: async () => {
                    await ShaderHub.addUniform( word );
                    await ShaderHub.compileShader( true, pass );
                    this.openUniformsDialog();
                } } );

                return options;
            },
            onNewTab: ( e ) => {
                const canCreateCommon = ( shader.passes.filter( p => p.type === "common" ).length === 0 );
                const canCreateBufferOrCompute = ( shader.passes.filter( p => p.type === "buffer" || p.type === "compute" ).length < 4 );
                const dmOptions = [
                    { name: "Common", icon: "FileText", disabled: !canCreateCommon, callback: ( v ) => ShaderHub.onShaderPassCreated( "common", v ) },
                    { name: "Buffer", icon: "Image", disabled: !canCreateBufferOrCompute, callback: ( v ) => ShaderHub.onShaderPassCreated( "buffer", v ) },
                    { name: "Compute", icon: "Binary", disabled: !canCreateBufferOrCompute, callback: ( v ) => ShaderHub.onShaderPassCreated( "compute", v ) },
                ];
                new LX.DropdownMenu( e.target, dmOptions, { side: "bottom", align: "start" });
            },
            onSelectTab: async ( name, editor ) => {
                ShaderHub.onShaderPassSelected( name );
            }
        });

        var [ graphicsArea, shaderDataArea ] = leftArea.split({ type: "vertical", sizes: ["auto", "auto"], resize: false });
        graphicsArea.root.className += " bg-none box-shadow rounded-lg";
        shaderDataArea.root.className += " bg-none box-shadow rounded-lg items-center justify-center";

        // Add Shader data
        this._createShaderDataView = async () =>
        {
            const shader = this.shader;
            const ownProfile = this.fs.user && ( shader.authorId === this.fs.getUserId() );
            const originalShader = shader.originalId ? await ShaderHub.getShaderById( shader.originalId ) : null;

            // Clear
            shaderDataArea.root.innerHTML = "";

            const shaderDataContainer = LX.makeContainer( [`100%`, "100%"], "p-6 flex flex-col gap-2 rounded-lg bg-secondary overflow-scroll overflow-x-hidden", "", shaderDataArea );
            const shaderNameAuthorOptionsContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-row", `
                <div class="flex flex-col gap-1">
                    <div class="flex flex-row items-center">
                        ${ ( ownProfile || isNewShader ) ? LX.makeIcon("Edit", { svgClass: "mr-2 cursor-pointer hover:fg-primary" } ).innerHTML : "" }
                        <div class="fg-primary text-xl font-semibold">${ shader.name }</div>
                    </div>
                    <div class="fg-secondary text-md">Created by ${ !shader.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shader.authorId }")' class='dodgerblue decoration-none cursor-pointer hover:text-underline'>` : `` }${ shader.author }${ !shader.anonAuthor ? "</a>" : "" } on ${ shader.creationDate }
                    ${ originalShader ? `(remixed from <a onclick='ShaderHub.openShader("${ shader.originalId }")' class='dodgerblue decoration-none cursor-pointer hover:text-underline'>${ originalShader.name }</a> by <a onclick='ShaderHub.openProfile("${ originalShader.authorId }")' class='dodgerblue decoration-none cursor-pointer hover:text-underline'>${ originalShader.author }</a>)` : `` }
                    </div>
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
                        shader.name = v;
                        this._editingName = false;
                    }, { inputClass: "fg-primary text-xxl font-semibold", pattern: LX.buildTextPattern( { minLength: 3 } ) } );
                    text.replaceWith( input.root );
                    LX.doAsync( () => input.root.focus() );
                    this._editingName = true;
                } )
            }

            const shaderOptions = LX.makeContainer( [`auto`, "auto"], "ml-auto flex flex-col p-1 gap-1 self-start items-center", ``, shaderNameAuthorOptionsContainer );

            if( this.fs.user )
            {
                const shaderOptionsButton = new LX.Button( null, "ShaderOptions", async () => {

                    const dmOptions = [ ]

                    let result = await ShaderHub.shaderExists();

                    if( ownProfile || isNewShader )
                    {
                        dmOptions.push(
                            mobile ? 0 : { name: "Save Shader", icon: "Save", callback: () => ShaderHub.saveShader( result ) },
                            isNewShader ? 0 : { name: "Share", icon: "Share2", callback: () => this.openShareiFrameDialog( result ) },
                            (isNewShader || mobile) ? 0 : { name: "Settings", icon: "Settings", callback: () => this.openShaderSettingsDialog( result ) }
                        );

                        if( result )
                        {
                            dmOptions.push(
                                mobile ? 0 : { name: "Update Preview", icon: "ImageUp", callback: () => ShaderHub.updateShaderPreview( shader.uid, true ) },
                                mobile ? 0 : null,
                                { name: "Delete Shader", icon: "Trash2", className: "fg-error", callback: () => ShaderHub.deleteShader() },
                            );
                        }
                    }
                    else
                    {
                        dmOptions.push( mobile ? 0 : { name: "Remix Shader", icon: "GitFork", disabled: !( result.remixable ?? true ), callback: () => ShaderHub.remixShader() } );
                    }

                    new LX.DropdownMenu( shaderOptionsButton.root, dmOptions.filter( o => o !== 0 ), { side: "bottom", align: "end" });

                }, { icon: "Menu" } );
                shaderOptions.appendChild( shaderOptionsButton.root );
            }
            else
            {
                LX.makeContainer( [`auto`, "auto"], "fg-secondary text-md", "Login to save/remix this shader", shaderOptions );
            }

            const shaderStats = LX.makeContainer( [`auto`, "auto"], "ml-auto flex p-1 gap-1 self-start items-center", `
                ${ LX.makeIcon( "Heart", { svgClass: "lg fill-current" } ).innerHTML } <span>${ shader.likes?.length ?? "" }</span>
            `, shaderOptions );

            const likeSpan = shaderStats.querySelector( "span" );
            const likeButton = shaderStats.querySelector( "svg" );

            LX.addSignal( "@on_like_changed", ( target, likeData ) => {
                const [ likesCount, alreadyLiked ] = likeData;
                likeSpan.innerHTML = likesCount;
                likeButton.classList.toggle( "fg-error", alreadyLiked );
            } );

            if( this.fs.user && !ownProfile && !isNewShader )
            {
                likeButton.classList.add( "hover:fg-error", "cursor-pointer" );
                likeButton.title = "Like Shader";
                LX.asTooltip( likeButton, likeButton.title );
                likeButton.addEventListener( "click", (e) => {
                    e.preventDefault();
                    ShaderHub.onShaderLike();
                } );
            }

            // Editable description
            {
                const descContainer = LX.makeContainer( [`auto`, "auto"], "fg-primary mt-2 flex flex-row items-center", `
                    <div class="w-auto self-start mt-1">${ ( ownProfile || ( shaderUid === "new" ) ) ? LX.makeIcon("Edit", { svgClass: "mr-3 cursor-pointer hover:fg-primary" } ).innerHTML : "" }</div>
                    <div class="desc-content w-full text-md break-words">${ shader.description }</div>
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
                            shader.description = v;
                            this._editingDescription = false;
                        }, { xwidth: "100%", resize: false, placeholder: "Enter your shader description here", className: "h-full", inputClass: "bg-tertiary h-full" , fitHeight: true } );
                        text.replaceWith( input.root );
                        LX.doAsync( () => input.root.focus() );
                        this._editingDescription = true;
                    } );
                }
            }
        }

        await this._createShaderDataView();

        // Add shader visualization UI
        {
            let [ canvasArea, canvasControlsArea ] = graphicsArea.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
            canvasArea.root.className += " bg-none";
            canvasControlsArea.root.className += " px-2 rounded-b-lg bg-secondary";

            const canvas = this.makeGPUCanvas();
            canvasArea.attach( canvas );

            const panel = canvasControlsArea.addPanel( { className: "flex flex-row" } );
            panel.sameLine();
            panel.addButton( null, "ResetTime", () => ShaderHub.onShaderTimeReset(), { icon: "SkipBack", title: "Reset time", tooltip: true } );
            panel.addButton( null, "PauseTime", () => ShaderHub.onShaderTimePaused(), { icon: "Pause", title: "Pause/Resume", tooltip: true, swap: "Play" } );
            panel.addLabel( "0.0", { signal: "@elapsed-time", inputClass: "size-content" } );
            panel.addLabel( "0 FPS", { signal: "@fps", inputClass: "size-content" } );
            panel.addLabel( "0x0", { signal: "@resolution", inputClass: "size-content" } );
            panel.endLine( "items-center h-full" );

            if( !mobile )
            {
                let exportOptions = {
                    format: "gif",
                    frames: "120",
                    framerate: "30"
                };

                const iUpdateExportOptions = ( o, v ) =>
                {
                    exportOptions[ o ] = v;
                };

                panel.sameLine();
                const container = LX.makeContainer( ["auto", "auto"], "bg-tertiary rounded-lg flex flex-row ml-auto", "", null, { backgroundColor: "var(--button-color)" } );
                this._recordButton = new LX.Button( null, "RecordButton", ( name, event ) => {
                    const iButton = this._recordButton.root.querySelector( "button" );
                    iButton.classList.remove( "bg-none", "lexbutton" );
                    iButton.classList.add( "bg-error", "hover:bg-error", "rounded-lg", "border-none" );
                    this.allowCapture = false;
                    ShaderHub.startCapture( exportOptions );
                }, { icon: "Video", className: "p-0", buttonClass: "bg-none record-button", title: "Record", tooltip: true } );
                container.appendChild( this._recordButton.root );
                const b = new LX.Button( null, "RecordSettingsButton", ( name, event ) => {
                    const button = event.target;
                    button["Format"] = exportOptions.format;
                    button["Frames"] = exportOptions.frames;
                    button["Frame Rate"] = exportOptions.framerate;
                    LX.addDropdownMenu( button, [
                        {
                            name: "Format",
                            icon: "FileArchive",
                            submenu: [ "gif", "png", "webm" ].map( o => {
                                const checked = ( exportOptions[ "format" ] === `${ o }` );
                                return { name: `${ checked ? LX.makeIcon( "Circle", { svgClass: "xxs fill-current inline-flex mr-2" } ).innerHTML : "" }${ o }`, callback: (v) => iUpdateExportOptions( "format", v ) };
                            } )
                        },
                        {
                            name: "Frames",
                            icon: "Film",
                            submenu: [ 60, 120, 180, 240, 300 ].map( o => {
                                const checked = ( exportOptions[ "frames" ] === `${ o }` );
                                return { name: `${ checked ? LX.makeIcon( "Circle", { svgClass: "xxs fill-current inline-flex mr-2" } ).innerHTML : "" }${ o }`, callback: (v) => iUpdateExportOptions( "frames", v ) };
                            } )
                        },
                        {
                            name: "Frame Rate",
                            icon: "Gauge",
                            submenu: [ 10, 15, 30, 60 ].map( o => {
                                const checked = ( exportOptions[ "framerate" ] === `${ o }` );
                                return { name: `${ checked ? LX.makeIcon( "Circle", { svgClass: "xxs fill-current inline-flex mr-2" } ).innerHTML : "" }${ o }`, callback: (v) => iUpdateExportOptions( "framerate", v ) };
                            } )
                        },
                    ], { side: "bottom", align: "end" });
                }, { icon: "ChevronDown", className: "p-0", buttonClass: "bg-none"});
                container.appendChild( b.root );
                panel.addContent( null, container );
                panel.addButton( null, "Fullscreen", () => ShaderHub.requestFullscreen(), { icon: "Fullscreen", title: "Fullscreen", tooltip: true } );
                panel.endLine( "items-center h-full ml-auto" );
            }

            ShaderHub.onShaderEditorCreated( shader, canvas );
        }
    },

    makeHelpView()
    {
        this.area.sections[ 1 ].root.classList.add( "hub-background" );
        const viewContainer = LX.makeContainer( [ "100%", "100%" ], "hub-background-blur", "", this.area );

        const header = LX.makeContainer( [ null, "200px" ], "flex flex-col gap-2 text-center items-center place-content-center", `
            <a><span class="fg-secondary">Documentation</span></a>
            <h1>Get started with ShaderHub</h1>
        `, viewContainer );

        const headerButtons = LX.makeContainer( [ "auto", "auto" ], "flex flex-row p-2", ``, header );
        const getStartedButton = new LX.Button( null, "Get Started", () => ShaderHub.openShader( "new" ), { buttonClass: "box-shadow contrast p-1 px-3" } );
        headerButtons.appendChild( getStartedButton.root );

        const content = LX.makeContainer( [ null, "calc(100% - 200px)" ], "help-content flex flex-col gap-2 px-10 pt-4 overflow-scroll", "", viewContainer );
        SET_DOM_TARGET( content );

        MAKE_HEADER( "Creating Shaders.", "h1", "creating-shaders" );

        MAKE_LINE_BREAK();

        MAKE_PARAGRAPH( `ShaderHub lets you create and run shaders right in your browser using WebGPU. You can write code, plug in textures or uniforms, and instantly see the results on the canvas. No setup, no downloads, just shaders that run on the web.` );
        MAKE_PARAGRAPH( `To create a new shader, simply click on the "New" button in the top menu bar. This will open a new shader editor where you can start coding your shader. The editor supports multiple passes, allowing you to create complex effects by layering different shaders together.
        Once you've written your shader code, you can compile and run it by clicking the "Run" button or using the ${ LX.makeKbd( ["Ctrl", "Space"], false, "text-lg inline-block bg-tertiary border px-1 rounded" ).innerHTML } or ${ LX.makeKbd( ["Ctrl", "Enter"], false, "text-lg inline-block bg-tertiary border px-1 rounded" ).innerHTML } shortcuts. The shader will be executed on the canvas, and you can see the results in real-time.` );

        MAKE_LINE_BREAK();

        MAKE_HEADER( "Shader Passes.", "h2", "shader-passes" );

        MAKE_PARAGRAPH( `ShaderHub supports multiple shader passes, which are essentially different stages of rendering that can be combined to create complex visual effects. There are two types of passes you can create: Buffer and Common.` );
        MAKE_BULLET_LIST( [
            `Buffers: Offscreen render targets that can be used to store intermediate results. You can create up to four buffer passes, which can be referenced in subsequent passes using the iChannel uniforms (iChannel0, iChannel1, etc.). This allows you to build effects step by step, using the output of one pass as the input for another.`,
            `Common: Used for shared code that can be included in other passes. This is useful for defining functions or variables that you want to reuse across multiple shader passes. You can only have one Common pass per shader.`
        ] );
        MAKE_PARAGRAPH( `To create a new pass, click on the "+" button in the editor's tab bar and select the type of pass you want to create. You can then write your shader code in the new tab that appears.` );

        MAKE_LINE_BREAK();

        MAKE_HEADER( "Uniforms and Textures.", "h2", "uniforms-and-textures" );

        MAKE_PARAGRAPH( `Uniforms are global variables that can be passed to your shader code. ShaderHub provides a set of default uniforms, such as iTime (elapsed time), iResolution (canvas resolution), and iMouse (mouse position), which you can use to create dynamic effects.` );
        MAKE_PARAGRAPH( `In addition to the default uniforms, you can also create custom uniforms to pass additional data to your shaders. To add a custom uniform, first open the Custom Uniforms popover using the button at the status bar (bottom of the editor), then click on the "+" button. You can specify the name and type of the uniform, and it will be available for use in your shader code.` );
        MAKE_PARAGRAPH( `Textures can be used in your shaders by assigning them to the iChannel uniforms. You must use existing textures from the ShaderHub library. To assign a texture to an iChannel, click on the corresponding channel in the status bar and select the texture you want to use.` );

        MAKE_LINE_BREAK();

        MAKE_HEADER( "Saving and Sharing Shaders.", "h2", "saving-and-sharing-shaders" );

        MAKE_PARAGRAPH( `Once you've created a shader that you're happy with, you can save it to your ShaderHub account by clicking the "Save" button in the shader options menu. This will store your shader in the server, allowing you to access it from any device.` );
        MAKE_PARAGRAPH( `You can also share your shaders with others by providing them with a direct link. Simply copy the URL from your browser's address bar and send it to anyone you want to share your shader with. They will be able to view, edit and run your shader in their own browser (not save it!).` );
        MAKE_PARAGRAPH( `If you want to allow others to remix your shader, you can enable the remix option in the shader settings. This will let other users create their own versions of your shader while still giving you credit as the original author.` );

        MAKE_LINE_BREAK();

        MAKE_HEADER( "Source Code.", "h1", "source-code" );

        MAKE_PARAGRAPH( `ShaderHub is an open-source project, and its source code is available on GitHub. You can find the repository <a href="https://github.com/upf-gti/ShaderHub">here</a>.` );

    //     MAKE_CODE( `@[com]// Split main area in 2 sections (2 Areas)@
    // @let@ [ left, right ] = area.@[mtd]split@({
    //     sizes: [@"70%"@, @"30%"@]
    // });
    // @[com]// Split again left area this time vertically@
    // @let@ [ leftUp, leftBottom ] = leftArea.@[mtd]split@({
    //     type: @"vertical"@,
    //     sizes: [@"80vh"@, @"20vh"@]
    // });` );
    },

    async makeStatusBarButtons( p, editor )
    {
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
                    this.defaultParametersPanel.addLabel( `${ u.name } : ${ u.type ?? "f32" }`, { className: "w-full p-0" } );
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
            ShaderHub.addUniform();
            this.customParametersPanel.refresh();
        }, { icon: "Plus", className: "ml-auto self-center", buttonClass: "bg-none", title: "Add New Uniform", tooltip: true, width: "38px" } );
        uniformsHeader.appendChild( addUniformButton.root );

        // Create the content for the uniforms panel
        {
            this.customParametersPanel = new LX.Panel({ className: "custom-parameters-panel w-full" });
            customParametersContainer.appendChild( this.customParametersPanel.root );

            this.customParametersPanel.refresh = ( overridePanel, onRefresh ) => {

                const pass = ShaderHub.currentPass;
                if( !pass || pass.type === "common" ) return;

                overridePanel = overridePanel ?? this.customParametersPanel;

                overridePanel.clear();

                overridePanel.addLabel( "Uniform names must start with i + Capital letter (e.g. iTime)." );

                for( let i = 0; i < pass.uniforms.length; ++i )
                {
                    const u = pass.uniforms[ i ];

                    overridePanel.sameLine();
                    overridePanel.addText( null, u.name, ( v ) => {
                        u.name = v;
                        ShaderHub.compileShader( true, pass );
                    }, { width: "25%", skipReset: true, pattern: "\\b(?!(" + Constants.DEFAULT_UNIFORM_NAMES.join("|") + ")\\b)(i[A-Z]\\w*)\\b" } );

                    const step = ( u.type.includes( "f" ) ) ? 0.01 : 1;

                    if( [ "f32", "i32", "u32" ].includes( u.type ) )
                    {
                        overridePanel.addNumber( "Min", u.min, ( v ) => {
                            u.min = v;
                            uRangeComponent.setLimits( u.min, u.max );
                            pass.uniformsDirty = true;
                        }, { nameWidth: "40%", width: "17%", skipReset: true, step } );
                        const uRangeComponent = overridePanel.addRange( null, u.value, ( v ) => {
                            u.value = v;
                            pass.uniformsDirty = true;
                        }, { className: "contrast", width: "35%", skipReset: true, min: u.min, max: u.max, step } );
                        overridePanel.addNumber( "Max", u.max, ( v ) => {
                            u.max = v;
                            uRangeComponent.setLimits( u.min, u.max );
                            pass.uniformsDirty = true;
                        }, { nameWidth: "40%", width: "17%", skipReset: true, step } );
                    }
                    else if( u.isColor )
                    {
                        const hasAlpha = ( u.type === "vec4f" );
                        const color = { r: u.value[ 0 ], g: u.value[ 1 ], b: u.value[ 2 ] };
                        if( hasAlpha )
                        {
                            color.a = u.value[ 3 ];
                        }
                        overridePanel.addColor( null, LX.rgbToHex( color ), ( v ) => {
                            u.value = [ v.r, v.g, v.b ];
                            if( hasAlpha ) u.value[ 3 ] = v.a;
                            pass.uniformsDirty = true;
                        }, { width: "69%", skipReset: true, useRGB: true } );
                    }
                    else
                    {
                        const vecFuncName = `addVector${ u.value.length }`;
                        overridePanel[ vecFuncName ]( null, u.value, ( v ) => {
                            u.value = v;
                            pass.uniformsDirty = true;
                        }, { width: "69%", skipReset: true, step } );
                    }

                    const optionsButton = overridePanel.addButton( null, "UniformOptionsButton", ( v ) =>
                    {
                        const iUpdateUniformType = ( v ) => {
                            ShaderHub.updateUniformType( pass, i, v );
                            this.customParametersPanel.refresh( overridePanel );
                        };

                        const menu = LX.addDropdownMenu( optionsButton.root, [
                            { name: "Number", submenu: [
                                { name: "f32", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "i32", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "u32", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                            ] },
                            { name: "Vec2", submenu: [
                                { name: "vec2f", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "vec2i", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "vec2u", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                            ] },
                            { name: "Vec3", submenu: [
                                { name: "vec3f", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "vec3i", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "vec3u", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                            ] },
                            { name: "Vec4", submenu: [
                                { name: "vec4f", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "vec4i", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                                { name: "vec4u", icon: "Cuboid", callback: iUpdateUniformType.bind( this ) },
                            ] },
                            { name: "Color", submenu: [
                                { name: "color3", icon: "Pipette", callback: iUpdateUniformType.bind( this ) },
                                { name: "color4", icon: "Pipette", callback: iUpdateUniformType.bind( this ) },
                            ] },
                            null,
                            { name: "Delete", icon: "Trash2", className: "fg-error", callback: () => {
                                ShaderHub.removeUniform( pass, i );
                                this.customParametersPanel.refresh( overridePanel );
                            }}
                        ], { side: "top", align: "end" });

                        menu.root.skipFocus = true;
                    }, { width: "6%", icon: "Menu", buttonClass: "bg-none" } );

                    overridePanel.endLine();
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
            const pass = ShaderHub.currentPass;
            if( pass.name === "Common" )
                return;

            this.customParametersPanel.refresh()
            this.openUniformsDialog( event.target );
        }, { icon: "Settings2", title: "Custom Parameters", tooltip: true } );

        /*
            Compile Button
        */

        customTabInfoButtonsPanel.addButton( null, "CompileShaderButton", async () => {
            await ShaderHub.compileShader( true, null, true );
        }, { icon: "Play", width: "32px", title: "Compile", tooltip: true } );

        customTabInfoButtonsPanel.endLine();

        p.root.prepend( customTabInfoButtonsPanel.root );
    },

    makeGPUCanvas()
    {
        const canvas = document.createElement("canvas");
        canvas.className = "webgpu-canvas w-full h-full rounded-b-none rounded-t-lg";
        canvas.tabIndex = "0";

        // Manage canvas resize
        {
            let iResize = ( xResolution, yResolution ) => {
                canvas.width = xResolution;
                canvas.height = yResolution;
                ShaderHub.onShaderCanvasResized( xResolution, yResolution );
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

        canvas.addEventListener('keydown', async (e) => {
            ShaderHub.onKeyDown( e );
            e.preventDefault();
        }, false);

        canvas.addEventListener('keyup', async (e) => {
            ShaderHub.onKeyUp( e );
            e.preventDefault();
        }, false);

        canvas.addEventListener("mousedown", (e) => {
            ShaderHub.onMouseDown( e );
        });

        canvas.addEventListener("mouseup", (e) => {
            ShaderHub.onMouseUp( e );
        });

        canvas.addEventListener("mousemove", (e) => {
            ShaderHub.onMouseMove( e );
        });

        return canvas;
    },

    async onLogin( user )
    {
        // Update login info
        const loginButton = document.getElementById( "loginOptionsButton" );
        if( loginButton )
        {
            loginButton.innerHTML = this.getLoginHtml( user );
        }

        // Hide signup info
        document.getElementById( "signupContainer" )?.classList.add( "hidden" );

        // Login feedback
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
        Utils.toast( `✅ Logged in`, `Welcome ${ user.email }!` );

        const params = new URLSearchParams( document.location.search );
        const queryShader = params.get( "shader" );
        if( queryShader )
        {
            await this._createShaderDataView();
        }
    },

    async onLogout()
    {
        await this.fs.logout();

        // Update login info
        const loginButton = document.getElementById( "loginOptionsButton" );
        if( loginButton )
        {
            loginButton.innerHTML = this.getLoginHtml();
        }

        // Show again signup info
        document.getElementById( "signupContainer" )?.classList.remove( "hidden" );

        // Update shader description (menu, likes, etc)
        const params = new URLSearchParams( document.location.search );
        const queryShader = params.get( "shader" );
        if( queryShader )
        {
            await this._createShaderDataView();
        }
    },

    onStopCapture()
    {
        const iButton = this._recordButton.root.querySelector( "button" );
        iButton.classList.remove( "bg-error",  "hover:bg-error" );
        iButton.classList.add( "bg-none", "lexbutton" );

        this.allowCapture = true;
    },

    openLoginDialog()
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const dialog = new LX.Dialog( "Login", ( p ) => {
            const formData = { email: { label: "Email", value: "", icon: "AtSign" }, password: { label: "Password", icon: "Key", value: "", type: "password" } };
            const form = p.addForm( null, formData, async (value, event) => {
                await this.fs.login( value.email, value.password, async ( user, session ) => {
                    dialog.close();
                    await this.onLogin( user );
                }, (err) => {
                    Utils.toast( `❌ Error`, err, -1 );
                } );
            }, { primaryActionName: "Login" });
            form.root.querySelector( "button" ).classList.add( "mt-2" );
        }, { modal: true } );

        this._lastOpenedDialog = dialog;
    },

    openSignUpDialog()
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

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
                else if( /\s/g.test( value.name ) )
                {
                    errorMsg.set( `❌ Name contains spaces.` );
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

                await this.fs.createAccount( value.email, value.password, value.name, async ( user ) => {
                    dialog.close();
                    document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
                    Utils.toast( `✅ Account created!`, `You can now login with your email: ${ value.email }` );

                    // Update DB
                    {
                        const result = await this.fs.createDocument( FS.USERS_COLLECTION_ID, {
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

        this._lastOpenedDialog = dialog;
    },

    openShaderSettingsDialog( r )
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        let shaderDirty = false;

        const dialog = new LX.Dialog( "Shader Settings", ( p ) => {

            p.addCheckbox( "Public", r.public ?? true, ( v ) => {
                shaderDirty = true;
                r.public = v;
            }, { className: "contrast" } );

            p.addCheckbox( "Allow Remix", r.remixable ?? true, ( v ) => {
                shaderDirty = true;
                r.remixable = v;
            }, { className: "contrast" } );

            p.addSeparator();

            p.sameLine( 2 );
            p.addButton( null, "Discard Changes", () => dialog.close(), { width: "50%", buttonClass: "bg-error fg-white" } );
            p.addButton( null, "Save Shader", async () => {
                if( !shaderDirty ) return;
                await this.fs.updateDocument( FS.SHADERS_COLLECTION_ID, r[ "$id" ], {
                    "public": r.public ?? true,
                    "remixable": r.remixable ?? true
                } );
                Utils.toast( `✅ Shader updated`, `Shader: ${ r.name } by ${ this.fs.user.name }` );
                shaderDirty = false;
                dialog.close();
            }, { width: "50%", buttonClass: "contrast" } );

        }, { modal: false } );

        this._lastOpenedDialog = dialog;
    },

    openShareiFrameDialog( r )
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        let showUI = true;

        const dialog = new LX.Dialog( "Share this Shader", ( p ) => {

            // direct link
            {
                p.addTextArea( null, `Direct link: Just copy and past the URL below:`, null, { inputClass: "fg-secondary", disabled: true, fitHeight: true } );
                const directLink = `${ window.location.origin }${ window.location.pathname }?shader=${ r[ "$id" ] }`;
                p.addTextArea( null, directLink, null, { disabled: true, fitHeight: true } );
                const copyButtonComponent = p.addButton(null, "Copy Shader URL",  async () => {
                    navigator.clipboard.writeText( directLink );
                    copyButtonComponent.root.querySelector( "input[type='checkbox']" ).style.pointerEvents = "none";
                    LX.doAsync( () => {
                        copyButtonComponent.swap( true );
                        copyButtonComponent.root.querySelector( "input[type='checkbox']" ).style.pointerEvents = "auto";
                    }, 3000 );
                }, { swap: "Check", icon: "Copy", iconPosition: "start", title: "Copy Shader URL", tooltip: true } );
                copyButtonComponent.root.querySelector( ".swap-on svg" ).addClass( "fg-success" );
            }

            p.addSeparator();

            // iframe code
            {
                p.addTextArea( null, `Direct link: Copy the code below to embed this shader in your website or blog:`, null, { inputClass: "fg-secondary", disabled: true, fitHeight: true } );
                p.addCheckbox( "Show UI", showUI, ( v ) => {
                    showUI = v;
                    const newUrl = `<iframe src="${ window.location.origin }${ window.location.pathname }embed/?shader=${ r[ "$id" ] }${ showUI ? "" : "&ui=false" }" frameborder="0" width="640" height="360" class="rounded-lg" allowfullscreen></iframe>`;
                    iframeText.set( newUrl );
                }, { className: "contrast" } );

                const iframeUrl = `<iframe src="${ window.location.origin }${ window.location.pathname }embed/?shader=${ r[ "$id" ] }${ showUI ? "" : "&ui=false" }" frameborder="0" width="640" height="360" class="rounded-lg" allowfullscreen></iframe>`;

                const iframeText = p.addTextArea( null, iframeUrl, null,
                    { disabled: true, fitHeight: true } );
                const copyButtonComponent = p.addButton(null, "Copy iFrame html",  async () => {
                    navigator.clipboard.writeText( iframeText.value() );
                    copyButtonComponent.root.querySelector( "input[type='checkbox']" ).style.pointerEvents = "none";
                    LX.doAsync( () => {
                        copyButtonComponent.swap( true );
                        copyButtonComponent.root.querySelector( "input[type='checkbox']" ).style.pointerEvents = "auto";
                    }, 3000 );
                }, { swap: "Check", icon: "Copy", iconPosition: "start", title: "Copy iFrame html", tooltip: true } );
                copyButtonComponent.root.querySelector( ".swap-on svg" ).addClass( "fg-success" );
            }
        }, { modal: false } );

        this._lastOpenedDialog = dialog;
    },

    openUniformsDialog()
    {
        const pass = ShaderHub.currentPass;
        if( pass?.name === "Common" )
        {
            return;
        }

        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const dialog = new LX.Dialog( `Uniforms [${ pass.uniforms.length }]`, null, {
            modal: false, draggable: true, size: [ Math.min( 600, window.innerWidth - 64 ), "auto" ]
        } );

        // Put all the stuff in the dialog panel
        this.customParametersPanel.refresh( dialog.panel );

        const uniformsHeader = LX.makeContainer( ["auto", "auto"], "flex flex-row items-center", "", dialog.title );
        const addUniformButton = new LX.Button( null, "AddNewCustomUniform", () => {
            ShaderHub.addUniform();
            this.customParametersPanel.refresh( dialog.panel, () => dialog.title.childNodes[ 0 ].textContent = `Uniforms [${ pass.uniforms.length }]` );
        }, { icon: "Plus", className: "ml-auto self-center", buttonClass: "bg-none", title: "Add New Uniform", width: "38px" } );
        uniformsHeader.appendChild( addUniformButton.root );
        LX.makeContainer( [`auto`, "0.75rem"], "ml-2 mr-4 border-right border-colored fg-quaternary self-center items-center", "", uniformsHeader );
        const closerButton = dialog.title.querySelector( "a" );
        uniformsHeader.appendChild( closerButton );
        // Re-add listener since it lost it changing the parent
        closerButton.addEventListener( "click", dialog.close );

        this._lastOpenedDialog = dialog;
    },

    async openAvailableChannels( pass, channelIndex )
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const _createChannelItems = async ( category, container ) => {

            const result = await this.fs.listDocuments( FS.ASSETS_COLLECTION_ID, [
                Query.equal( "category", category )
            ] );

            if( result.total === 0 )
            {
                LX.makeContainer( ["100%", "auto"], "mt-8 text-xxl font-medium justify-center text-center", "No channels found.", container );
                return;
            }

            const usedMiscChannels = [ "Keyboard", ...( ShaderHub.shader?.passes.map( p => p.name ) ?? [] ) ];

            for( const document of result.documents )
            {
                if( category === "misc" && !usedMiscChannels.includes( document.name ) )
                {
                    continue;
                }

                const channelItem = LX.makeElement( "li", "relative flex rounded-lg bg-secondary hover:bg-tertiary overflow-hidden", "", container );
                channelItem.style.maxHeight = "200px";
                const channelPreview = LX.makeElement( "img", "w-full h-full rounded-t-lg bg-secondary hover:bg-tertiary border-none cursor-pointer", "", channelItem );
                const fileId = document[ "file_id" ];
                const preview = document[ "preview" ];
                const localUrl = document[ "local_url" ];
                channelPreview.src = preview ? await this.fs.getFileUrl( preview ) : ( fileId ? await this.fs.getFileUrl( fileId ) : ( localUrl ?? "images/shader_preview.png" ) );;
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "absolute top-0 p-2 w-full bg-blur items-center select-none text-sm font-bold", `
                    ${ document.name } (uint8)
                `, channelItem );
                channelItem.addEventListener( "click", async ( e ) => {
                    e.preventDefault();
                    pass.channels[ this._currentChannelIndex ] = fileId ?? document.name;
                    await this.updateShaderChannelsView( pass, this._currentChannelIndex );
                    pass.mustCompile = true;
                    dialog.close();
                } );
            }
        }

        const area = new LX.Area( { skipAppend: true } );
        const tabs = area.addTabs( { parentClass: "bg-secondary p-4", sizes: [ "auto", "auto" ], contentClass: "bg-secondary p-4 pt-0" } );

        if( !this.texturesContainer )
        {
            this.texturesContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-4 p-4 border rounded-lg justify-center overflow-scroll" );
            await _createChannelItems( "texture", this.texturesContainer );
        }
        this.texturesContainer.style.display = "grid";
        tabs.add( "Textures", this.texturesContainer, { selected: true } );

        if( !this.miscContainer )
        {
            this.miscContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-4 p-4 border rounded-lg justify-center overflow-scroll" );
        }
        this.miscContainer.innerHTML = "";
        await _createChannelItems( "misc", this.miscContainer );
        this.miscContainer.style.display = "grid";
        tabs.add( "Misc", this.miscContainer, { xselected: true } );

        this._currentChannelIndex = channelIndex;

        let dialog = new LX.Dialog( `Channel${ channelIndex } input:`, (p) => {
            p.attach( area );
        }, { modal: false, close: true, minimize: false, size: [`${ Math.min( 1280, window.innerWidth - 64 ) }px`, "512px"], draggable: true });

        this._lastOpenedDialog = dialog;
    },

    async updateShaderChannelsView( pass, channel )
    {
        pass = pass ?? ShaderHub.currentPass;

        this.toggleShaderChannelsView( pass.type === "common" );

        const iUpdateChannel = async ( channelIndex ) => {

            const child = this.channelsContainer.children[ channelIndex ];
            if( child ) this.channelsContainer.removeChild( child );

            const channelContainer = LX.makeContainer( ["100%", "100%"], "relative text-center content-center box-shadow rounded-lg bg-secondary hover:bg-tertiary cursor-pointer overflow-hidden", "" );
            channelContainer.style.minHeight = "100px";
            this.channelsContainer.insertChildAtIndex( channelContainer, channelIndex );

            const channelImage = LX.makeElement( "img", "rounded-lg bg-secondary hover:bg-tertiary border-none", "", channelContainer );
            const metadata = await ShaderHub.getChannelMetadata( pass, channelIndex );
            let imageSrc = Constants.IMAGE_EMPTY_SRC;
            if( metadata.url )
            {
                if( !this.imageCache[ metadata.url ] )
                {
                    this.imageCache[ metadata.url ] = await Utils.imageToDataURL( fs, metadata.url )
                }

                imageSrc = this.imageCache[ metadata.url ];
            }
            channelImage.src = imageSrc;
            channelImage.style.width = "95%";
            channelImage.style.height = "95%";
            const channelTitle = LX.makeContainer( ["100%", "auto"], "p-2 absolute bg-secondary text-sm text-center content-center top-0 channel-title pointer-events-none",
                metadata.name ? `${ metadata.name } (iChannel${ channelIndex })` : `iChannel${ channelIndex }`, channelContainer );
            channelContainer.addEventListener( "click", async ( e ) => {
                e.preventDefault();
                await this.openAvailableChannels( pass, channelIndex );
            } );
            channelContainer.addEventListener("contextmenu", ( e ) => {
                e.preventDefault();
                new LX.DropdownMenu( e.target, [
                    { name: "Remove", className: "bg-error fg-white", callback: async () => await ShaderHub.removeUniformChannel( channelIndex ) },
                ], { side: "top", align: "start" });
            });
        }

        if( channel !== undefined )
        {
            iUpdateChannel( channel );
            return;
        }

        for( let i = 0; i < Constants.UNIFORM_CHANNELS_COUNT; i++ )
        {
            iUpdateChannel( i );
        }

        console.log( "Channels view updated." );
    },

    toggleShaderChannelsView( force )
    {
        this.channelsContainer.parentElement.classList.toggle( "hidden", force );
    },

    toggleCustomUniformsButton( force )
    {
        this.openCustomParamsButton.root.classList.toggle( "hidden", force );
    }
};
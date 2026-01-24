import { LX } from 'lexgui';
import 'lexgui/extensions/CodeEditor.js';
import { DocMaker } from 'lexgui/extensions/DocMaker.js';
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

        LX.setThemeColor( 'orange' );

        const params = new URLSearchParams( document.location.search );
        const starterMode = LX.getMode();

        const menubarOptions = [];
        const menubarButtons = [
            {
                title: "Switch Mode",
                icon: starterMode == "dark" ? "Moon" : "Sun",
                swap: starterMode == "dark" ? "Sun" : "Moon",
                callback: (value, event) => { LX.switchMode() }
            }
        ];

        if( !mobile )
        {
            menubarOptions.push(
                {
                    name: "New", callback: ( k, entry, event ) => ShaderHub.openShader( "new", event )
                },
                {
                    name: "Browse", callback: ( k, entry, event ) => ShaderHub.openPage( k.toLowerCase(), event )
                },
                {
                    name: "Help", callback: ( k, entry, event ) => ShaderHub.openPage( k.toLowerCase(), event )
                }
            );
        }

        const menubar = this.area.addMenubar( menubarOptions, { parentClass: "bg-none" } );

        const querySearch = params.get( "search" );
        const searchShaderInput = new LX.TextInput(null, querySearch ?? '', v => {
            if( v.length ) this._searchShader( v )
        }, { placeholder: "Search shaders...", width: "256px", className: "hidden md:flex right" });
        menubar.root.appendChild( searchShaderInput.root );

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

            if( fs.user )
            {
                const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", fs.getUserId() ) ] );
                const dbUser = users.documents[ 0 ];
                sidebarOptions.headerImage = dbUser.avatar;
            }

            const sidebarCallback = m => {
                if( fs.user )
                {
                    m.add( "Profile", { icon: "User", callback: () => ShaderHub.openProfile( fs.getUserId() ) } );
                    m.add( "Browse", { icon: "Search", callback: () => ShaderHub.openPage( "browse" ) } );
                    m.add( "Help", { icon: "HelpCircle", callback: () => ShaderHub.openPage( "help" ) } );
                    m.add( "Logout", { icon: "LogOut", callback: async () => {
                        await this.onLogout();
                    } } );
                }
                else
                {
                    m.add( "Login", { icon: "LogIn", callback: () => this.openLoginDialog() } );
                    m.add( "Browse", { icon: "Search", callback: () => ShaderHub.openPage( "browse" ) } );
                    m.add( "Help", { icon: "HelpCircle", callback: () => ShaderHub.openPage( "help" ) } );
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

            const signupOptionsButton = new LX.Button( null, "Create account", () => this.openSignUpDialog(), { buttonClass: 'ghost h-8 px-4' } );
            signupContainer.appendChild( signupOptionsButton.root );

            LX.makeContainer( [`auto`, "0.85rem"], "border-right border-color text-foreground self-center items-center", "", signupContainer );

            this.getLoginHtml = async ( user ) => {

                if ( !user )
                {
                    this._setLoginButtonClass( 'primary' );
                    return "Login";
                }

                const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", fs.getUserId() ) ] );
                if( users.total === 0 )
                {
                    this._setLoginButtonClass( 'primary' );
                    return "Login";
                }

                const dbUser = users.documents[ 0 ];
                const avatar = new LX.Avatar({
                    imgSource: dbUser.avatar,
                    fallback: dbUser.user_name[ 0 ].toUpperCase(),
                    className: 'mx-2 size-5',
                });

                this._setLoginButtonClass( 'ghost' );

                return  `<span class="hidden md:block decoration-none">${ user.email }</span>
                    ${ avatar.root.outerHTML }
                    ${ LX.makeIcon("ChevronsUpDown", { iconClass: "pl-2" } ).innerHTML }`;
            };

            const loginOptionsButton = new LX.Button( null, '', async () => {
                if( fs.user )
                {
                    new LX.DropdownMenu( loginOptionsButton.root, [
                        fs.user.name,
                        null,
                        { name: "Profile", icon: "User", callback: () => ShaderHub.openProfile( fs.getUserId() ) },
                        null,
                        { name: "Logout", icon: "LogOut", className: "destructive", callback: async () => {
                            await this.onLogout();
                        } },
                    ], { side: "bottom", align: "end", alignOffset: -12 });
                }
                else
                {
                    this.openLoginDialog();
                }
            }, { className: "mr-4", buttonClass: 'ghost h-8 px-4' } );
            loginOptionsButton.root.id = "loginOptionsButton";

            const loginOptionsButtonDOM = loginOptionsButton.root.querySelector( "button" );
            LX.doAsync( async () => { loginOptionsButtonDOM.innerHTML = await this.getLoginHtml( fs.user ) }, 10 );

            menubar.root.appendChild( loginOptionsButton.root );
        }

        menubar.setButtonImage("ShaderHub", mobile ? `images/favicon.png` : `images/icon_${ starterMode }.png`, ( element, event ) => {
            const needsReload = ( window.location.search === "" );
            window.location.hash = "";
            window.open( `${ ShaderHub.getFullPath() }`, event?.button !== 1 ? "_self" : undefined );
            if( needsReload ) window.location.reload();
        }, { float: "left" } );

        LX.addSignal( "@on_new_color_scheme", ( el, value ) => {
            if( !mobile )
            {
                menubar.setButtonImage("ShaderHub", `images/icon_${ value }.png`, null, { float: "left" } );
            }
        } );

        menubar.root.classList.add( "hub-background-blur-md" );
        menubar.siblingArea.root.classList.add( "content-area" );

        const queryShader = params.get( "shader" );
        const queryProfile = params.get( "profile" );

        if( queryShader )
        {
            await this.makeShaderView( queryShader );
        }
        else if( queryProfile )
        {
            await this.makeProfileView( queryProfile );
        }
        else
        {
            const hash = window.location.hash ?? "";
            if( hash === "#browse" )
            {
                this.makeBrowseList();
            }
            else if( hash === "#help" )
            {
                this.makeHelpView();
            }
            else
            {
                await this.makeInitialPage();
            }
        }

        const isPasswordRecovery = params.get( "verifyEmail" ) === "true";
        const queryPasswordRecoverySecret = params.get( "secret" );
        const queryPasswordRecoveryUserId = params.get( "userId" );
        if( isPasswordRecovery )
        {
            // use data for email verification
            const result = await fs.account.updateEmailVerification({
                userId: queryPasswordRecoveryUserId,
                secret: queryPasswordRecoverySecret
            });
            if( result )
            {
                Utils.toast( `✅ Email verified successfully!`, `User: ${ fs.user.name }` );
            }
            
        }
        else if( queryPasswordRecoverySecret && queryPasswordRecoveryUserId )
        {
            this.openUpdatePasswordRecoverDialog( queryPasswordRecoveryUserId, queryPasswordRecoverySecret );
        }
    },

    _setLoginButtonClass( className )
    {
        const loginButton = document.querySelector( "#loginOptionsButton button" );
        if( !loginButton ) return;

        LX.removeClass( loginButton, 'primary ghost' );
        LX.addClass( loginButton, className );
    },

    _searchShader( v )
    {
        const url = new URL( window.location.href );
        if( v && v.trim() )
        {
            url.searchParams.set( 'search', v.trim() );
        }
        else
        {
            url.searchParams.delete( 'search' );
        }
        // Remove shader params if any since this can be done from any view
        url.searchParams.delete( 'shader' );
        url.searchParams.delete( 'profile' );
        url.hash = 'browse';
        window.location.href = url.toString();
    },

    _browsePage( v )
    {
        const url = new URL( window.location.href );
        if( v && v.trim() )
        {
            url.searchParams.set( 'page', v.trim() );
        }
        else
        {
            url.searchParams.delete( 'page' );
        }
        url.hash = 'browse';
        window.location.href = url.toString();
    },

    _browseFeature( v )
    {
        const url = new URL( window.location.href );
        const alreadyThere = ( url.searchParams.get( "feature" ) === v );
        if( v && v.trim() && !alreadyThere )
        {
            url.searchParams.set( 'feature', v.trim() );
        }
        else
        {
            url.searchParams.delete( 'feature' );
        }
        url.searchParams.delete( 'page' ); // Reset page when changing feature
        url.hash = 'browse';
        window.location.href = url.toString();
    },

    _browseOrderBy( v )
    {
        const url = new URL( window.location.href );
        const alreadyThere = ( url.searchParams.get( "order_by" ) === v );
        if( v && v.trim() && !alreadyThere )
        {
            url.searchParams.set( 'order_by', v.trim() );
        }
        else
        {
            url.searchParams.delete( 'order_by' );
        }
        url.searchParams.delete( 'page' ); // Reset page when changing feature
        url.hash = 'browse';
        window.location.href = url.toString();
    },

    _makeFooter( area )
    {
        LX.makeContainer( [`auto`, "auto"], "text-foreground text-sm flex flex-row gap-2 self-center items-center text-center place-content-center", `
            ${ LX.makeIcon("Github@solid", { svgClass:"lg" } ).innerHTML }<a class="decoration-none hover:underline underline-offset-4" href="https://github.com/upf-gti/ShaderHub">Code on Github</a>`, area );
    },

    async makeInitialPage()
    {
        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", "48px"], resize: false });
        this.area.root.className += " hub-background";
        bottomArea.root.className += " items-center content-center";
        topArea.root.className += " flex flex-row hub-background-blur content-area";

        this._makeFooter( bottomArea );

        let leftSide = LX.makeContainer( ["auto", "100%"], "bg-none flex flex-col p-8 gap-2 overflow-scroll", "", topArea );
        leftSide.style.minWidth = "50%";
        let rightSide = LX.makeContainer( ["100%", "100%"], "bg-none flex flex-col p-8 place-content-center items-center", "", topArea );

        // Create title/login area
        {
            const container = LX.makeContainer( ["100%", "100%"], "bg-background-blur flex flex-col gap-4 rounded-xl box-shadow box-border place-content-center items-center overflow-scroll", "", rightSide );
            
            if( this.fs.user )
            {
                const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", this.fs.getUserId() ) ] );
                const dbUser = users.documents[ 0 ];
                const welcomeMessage = LX.makeContainer( ["100%", "auto"], "p-8 text-center text-3xl text-card-foreground", `Welcome ${ dbUser.display_name ?? dbUser.user_name }!`, container );
                welcomeMessage.id = "welcomeMessage";
            }
            
            const header = LX.makeContainer( [ null, "auto" ], "flex flex-col mt-8 px-10 gap-4 text-center items-center place-content-center", `
                <img src="images/favicon.png" class="">
                <span class="mb-6 text-muted-foreground text-2xl sm:text-3xl font-medium">ShaderHub (beta ${ ShaderHub.version })</span>
                <span class="text-balanced text-4xl sm:text-5xl font-medium">Create and Share Shaders using latest WebGPU!</span>
                <a onclick='ShaderHub.openShader("6963e7bd0533036adf87")' class="flex flex-row gap-1 items-center text-sm p-1 px-4 rounded-full text-secondary-foreground decoration-none hover:bg-secondary cursor-pointer"><span class="flex bg-orange-500 w-2 h-2 rounded-full"></span>
                New Sound Channel, User Avatars, Shader Comments, UI Improvements${ LX.makeIcon( "ArrowRight", { svgClass: "sm" } ).innerHTML }</a>
            `, container );

            if( !mobile )
            {
                const headerButtons = LX.makeContainer( [ "auto", "auto" ], "flex flex-row p-2", ``, header );
                const getStartedButton = new LX.Button( null, "Create a Shader", () => ShaderHub.openShader( "new" ), { icon: "ChevronRight", iconPosition: "end", buttonClass: "lg primary" } );
                headerButtons.appendChild( getStartedButton.root );
            }

            if( !this.fs.user )
            {
                const loginContainer = LX.makeContainer( ["100%", "auto"], "max-w-128 flex flex-col gap-2 p-6 text-center text-card-foreground", "Sign in to save your shaders:", container );
                const formData = { email: { label: "Email", value: "", icon: "AtSign" }, password: { label: "Password", icon: "Key", value: "", type: "password" } };
                const form = new LX.Form( null, formData, async (value, event) => {
                    await this.fs.login( value.email, value.password, async ( user, session ) => {
                        await this.onLogin( user );
                    }, (err) => {
                        Utils.toast( `❌ Error`, err, -1 );
                    } );
                }, { primaryActionName: "Login" });
                loginContainer.appendChild( form.root );
                const forgotButton = new LX.Button( null, "Forgot my password", async () => {
                    this.openRecoverPasswordDialog();
                }, { buttonClass: "link" } );
                loginContainer.appendChild( forgotButton.root );
            }
        }

        let skeletonHtml = "";

        for( let i = 0; i < 3; ++i )
        {
            const shaderItem = LX.makeElement( "li", `shader-item ${ i === 0 ? "featured" : "" } lexskeletonpart relative bg-background-blur hover:bg-accent overflow-hidden flex flex-col h-auto`, "" );
            const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-lg bg-background-blur hover:bg-accent border-none cursor-pointer self-center mt-2", "", shaderItem );
            shaderPreview.style.width = "calc(100% - 1rem)";
            shaderPreview.style.height = "calc(100% - 1rem)";
            shaderPreview.src = "images/shader_preview.png";
            LX.makeContainer( ["100%", "auto"], "bg-background-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                <div class="w-full flex flex-col gap-1">
                    <div class="w-3/4 h-3 lexskeletonpart"></div>
                    <div class="w-1/2 h-3 lexskeletonpart"></div>
                </div>`, shaderItem );

            skeletonHtml += shaderItem.outerHTML;
        }

        LX.makeContainer( ["100%", "auto"], "font-medium text-card-foreground", `Featured Shaders`, leftSide, { fontSize: "2rem" } );

        const skeleton = new LX.Skeleton( skeletonHtml );
        skeleton.root.classList.add( "grid", "shader-list-initial", "gap-8", "justify-center" );
        leftSide.appendChild( skeleton.root );

        // Get all stored shader files (not the code, only the data)
        const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, [
            Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ),
            Query.orderDesc( 'like_count' ),
            Query.limit( 3 ),
        ] );

        const previewFiles = await this.fs.listFiles( [
            Query.startsWith( "name", ShaderHub.previewNamePrefix ),
            Query.endsWith( "name", ".png" ),
            Query.contains( "name", result.documents.map( d => d[ "$id" ] ) )
        ] );

        const usersDocuments = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [
            Query.contains( "user_id", result.documents.map( d => d[ "author_id" ] ) )
        ] );

        LX.doAsync( async () => {

            let shaderList = [];

            for( const document of result.documents )
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
                    const userDocument = usersDocuments.documents.find( d => d[ "user_id" ] === authorId );
                    const author = userDocument[ "user_name" ];
                    shaderInfo.author = author;
                    shaderInfo.authorId = authorId;
                }
                else
                {
                    shaderInfo.author = document[ "author_name" ];
                    shaderInfo.anonAuthor = true;
                }

                const previewName = ShaderHub.getShaderPreviewName( shaderInfo.uid );
                const previewFile = previewFiles.files.find( f => f.name === previewName );
                if( previewFile )
                {
                    shaderInfo.preview = await this.fs.getFileUrl( previewFile[ "$id" ] );
                }
                else
                {
                    console.warn( `Can't find shader preview image for Shader: ${ shaderInfo.name }` );
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
                shaderPreview.style.width = "calc(100% - 1rem)";
                shaderPreview.src = shader.preview ?? "images/shader_preview.png";
                shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                shaderItem.querySelector( "div" ).remove();
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "flex flex-row bg-card hover:bg-accent rounded-b-lg gap-6 p-4 select-none", `
                    <div class="w-full">
                        <div class="text-md font-bold">${ shader.name }</div>
                        <div class="text-sm font-light">by ${ !shader.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shader.authorId }")' class='hub-link font-medium'>` : "" }<span>${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" }</div>
                    </div>
                    <div class="flex flex-row gap-1 items-center">
                        ${ LX.makeIcon( "Heart", { svgClass: "fill-current text-card-foreground" } ).innerHTML }
                        <span>${ shader.likeCount ?? 0 }</span>
                    </div>`, shaderItem );

                shaderPreview.addEventListener( "mousedown", e => e.preventDefault() );
                shaderPreview.addEventListener( "mouseup", ( e ) => {
                    ShaderHub.openShader( shader.uid, e );
                } );
            }

            if( shaderList.length === 0 )
            {
                skeleton.root.innerHTML = "";
                LX.makeContainer( ["100%", "auto"], "mt-8 text-2xl font-medium justify-center text-center", "No shaders found.", skeleton.root );
            }

        }, 10 );
    },

    async makeBrowseList()
    {
        const params = new URLSearchParams( document.location.search );
        const queryFeature = params.get( "feature" );
        const queryOrderBy = params.get( "order_by" );
        const queryPage = params.get( "page" );
        const querySearch = params.get( "search" );

        var [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.parentElement.classList.add( "hub-background" )
        topArea.root.className += " p-6 overflow-scroll hub-background-blur";
        bottomArea.root.className += " hub-background-blur-md items-center content-center";

        const header = LX.makeContainer( ["100%", "auto"], `flex ${ mobile ? "flex-col mb-2" : "flex-row" } font-medium text-card-foreground`, ``, topArea, { fontSize: "2rem" } );

        this._makeFooter( bottomArea );

        // Filters
        {
            const filtersPanel = new LX.Panel( { className: "p-4 bg-none", height: "auto" } );
            filtersPanel.sameLine();

            filtersPanel.addLabel( "Filter Features", { fit: true } );

            for( let f of Constants.FEATURES )
            {
                const fLower = f.toLowerCase();
                filtersPanel.addButton( null, f, (v) => this._browseFeature( v.toLowerCase() ), { buttonClass: `xs ${queryFeature === fLower ? "primary" : "outline bg-card!"}` } );
            }

            filtersPanel.endLine();
            header.appendChild( filtersPanel.root );
        }

        // Browsing Shader Order
        {
            const filtersPanel = new LX.Panel( { className: "p-4 bg-none", height: "auto" } );
            filtersPanel.sameLine();

            filtersPanel.addLabel( "Order by", { fit: true } );

            for( let f of Constants.ORDER_BY_NAMES )
            {
                const fLower = f.toLowerCase();
                filtersPanel.addButton( null, f, (v) => this._browseOrderBy( v.toLowerCase() ), { buttonClass: `xs ${queryOrderBy === fLower ? "primary" : "outline bg-card!"}` } );
            }

            filtersPanel.endLine();
            header.appendChild( filtersPanel.root );
        }

        {
            this.paginator = new LX.Pagination({
                maxButtons: 4,
                useEllipsis: true,
                alwaysShowEdges: false,
                xallowChangeItemsPerPage: true,
                onChange: (page) => {
                    this._browsePage( page.toString() );
                }
            });
            header.appendChild( this.paginator.root );
        }

        const PAGE_LIMIT = 25;
        const page = queryPage ? parseInt( queryPage ) : 1;
        const orderBy = queryOrderBy ? Constants.ORDER_BY_MAPPING[ queryOrderBy ] : Constants.ORDER_BY_MAPPING[ "recent" ];
        console.log( "Order by:", orderBy );

        const shaderQueries = [
            Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ),
            orderBy.direction === "asc" ? Query.orderAsc( orderBy.field ) : Query.orderDesc( orderBy.field ),
            Query.offset( ( page - 1 ) * PAGE_LIMIT )
        ]

        if( queryFeature )
        {
            shaderQueries.push( Query.contains( "features", queryFeature ) );
        }

        // Get all stored shader files (not the code, only the data)
        const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, shaderQueries );

        this.paginator.setPages( Math.ceil( result.total / PAGE_LIMIT ) );
        this.paginator.setPage( page );

        const dbShaders = ShaderHub.filterShaders( result.documents, querySearch );
        if( dbShaders.length === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-2xl font-medium justify-center text-center", "No shaders found.", topArea );
            return;
        }

        let skeletonHtml = "";

        for( let i = 0; i < dbShaders.length; ++i )
        {
            const shaderItem = LX.makeElement( "li", `shader-item lexskeletonpart relative bg-background-blur hover:bg-accent overflow-hidden flex flex-col h-auto`, "" );
            const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-lg bg-background-blur hover:bg-accent border-none cursor-pointer self-center mt-2", "", shaderItem );
            shaderPreview.style.width = "calc(100% - 1rem)";
            shaderPreview.style.height = "calc(100% - 1rem)";
            shaderPreview.src = "images/shader_preview.png";
            LX.makeContainer( ["100%", "auto"], "absolute bottom-0 bg-background-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                <div class="w-full flex flex-col gap-1">
                    <div class="w-3/4 h-3 lexskeletonpart"></div>
                    <div class="w-1/2 h-3 lexskeletonpart"></div>
                </div>`, shaderItem );

            skeletonHtml += shaderItem.outerHTML;
        }

        const skeleton = new LX.Skeleton( skeletonHtml );
        skeleton.root.classList.add( "grid", "shader-list", "gap-6", "justify-center" );
        topArea.attach( skeleton.root );

        // This should list only the preview files we need
        const previewFiles = await this.fs.listFiles( [
            Query.startsWith( "name", ShaderHub.previewNamePrefix ),
            Query.endsWith( "name", ".png" ),
            Query.contains( "name", dbShaders.map( d => d[ "$id" ] ) )
        ] );
        const usersDocuments = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_name", dbShaders.map( d => d[ "author_name" ] ) ) ] );

        LX.doAsync( async () => {

            let shaderList = [];
            let dbUser = null;

            if( this.fs.user )
            {
                const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", this.fs.getUserId() ) ] );
                dbUser = users.documents[ 0 ];
            }

            for( const document of dbShaders )
            {
                const name = document.name;

                const shaderInfo = {
                    name,
                    uid: document[ "$id" ],
                    creationDate: Utils.toESDate( document[ "$createdAt" ] ),
                    likeCount: document[ "like_count" ],
                    features: ( document[ "features" ] ?? "" ).split( "," ),
                    public: document[ "public" ] ?? true,
                    liked: dbUser ? ( dbUser.liked_shaders ?? [] ).includes( document[ "$id" ] ) : false
                };

                const authorId = document[ "author_id" ];
                if( authorId )
                {
                    const userDocument = usersDocuments.documents.find( d => d[ "user_id" ] === authorId );
                    const author = userDocument[ "user_name" ];
                    shaderInfo.author = author;
                    shaderInfo.authorId = authorId;
                }
                else
                {
                    shaderInfo.author = document[ "author_name" ];
                    shaderInfo.anonAuthor = true;
                }

                const previewName = ShaderHub.getShaderPreviewName( shaderInfo.uid );
                const previewFile = previewFiles.files.find( f => f.name === previewName );
                if( previewFile )
                {
                    shaderInfo.preview = await this.fs.getFileUrl( previewFile[ "$id" ] );
                }
                else
                {
                    console.warn( `Can't find shader preview image for Shader: ${ shaderInfo.name }` );
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
                shaderPreview.style.width = "calc(100% - 1rem)";
                shaderPreview.src = shader.preview ?? "images/shader_preview.png";
                shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                shaderItem.querySelector( "div" ).remove();
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                    <div class="w-full">
                        <div class="text-base font-bold">${ shader.name }</div>
                        <div class="text-sm font-light">by ${ !shader.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shader.authorId }")' class='hub-link font-medium'>` : "" }<span>${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" }</div>
                    </div>
                    <div class="flex flex-row gap-1 items-center">
                        ${ LX.makeIcon( "Heart", { svgClass: `${ shader.liked ? "text-orange-600" : "" } fill-current` } ).innerHTML }
                        <span>${ shader.likeCount ?? 0 }</span>
                    </div>`, shaderItem );

                shaderPreview.addEventListener( "mousedown", e => e.preventDefault() );
                shaderPreview.addEventListener( "mouseup", ( e ) => {
                    ShaderHub.openShader( shader.uid, e );
                } );
            }

            // console.log( `${ (LX.getTime() - a)*0.001 }s` );

            this.shaderList = shaderList;
        }, 10 );
    },

    async makeShaderView( shaderUid )
    {
        this.area.root.style.height = "100dvh";

        const shader = await ShaderHub.getShaderById( shaderUid );
        this.shader = shader;

        let [ leftArea, rightArea ] = this.area.split({ sizes: ["50%", "50%"] });
        rightArea.root.className = rightArea.root.className.replace("bg-background", "bg-none p-3 shader-edit-content");
        leftArea.root.className = leftArea.root.className.replace("bg-background", "bg-none p-3 flex flex-col gap-2");

        // Set background to parent area
        this.area.root.parentElement.className = this.area.root.parentElement.className.replace( "bg-background", "hub-background" );
        leftArea.root.parentElement.classList.add( "hub-background-blur" );

        let [ codeArea, shaderSettingsArea ] = rightArea.split({ type: "vertical", sizes: ["80%", "20%"], resize: false });
        codeArea.root.className += " box-shadow rounded-xl overflow-hidden code-border-default";
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

        if( mobile )
        {
            // Create unused editor by now
            this.editor = new LX.CodeEditor( codeArea );
            this.onCodeEditorReady( undefined, leftArea );
            return;
        }

        this.editor = await new LX.CodeEditor( codeArea, {
            allowClosingTabs: false,
            allowLoadingFiles: false,
            fileExplorer: false,
            defaultTab: false,
            statusShowEditorIndentation: false,
            statusShowEditorLanguage: false,
            statusShowEditorFilename: false,
            customSuggestions: ShaderHub.getCurrentSuggestions(),
            onCreateStatusPanel: this.makeStatusBarButtons.bind( this ),
            onCtrlSpace: iCompileShader.bind( this ),
            onSave: iCompileShader.bind( this ),
            onRun: iCompileShader.bind( this ),
            onCreateFile: ( editor ) => null,
            onContextMenu: ( editor, content, event ) => {
                const pass = ShaderHub.currentPass;
                if( pass.name === "Common" || !content ) return;

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
            },
            onReady: async ( editor ) => {
                await this.onCodeEditorReady( editor, leftArea );
            }
        });
    },

    async onCodeEditorReady( editor, area )
    {
        let [ graphicsArea, shaderDataArea ] = area.split({ type: "vertical", sizes: ["auto", "auto"], resize: false });
        graphicsArea.root.className += " bg-none box-shadow box-border rounded-xl overflow-hidden flex-auto-keep";
        shaderDataArea.root.className += " bg-none box-shadow box-border rounded-xl items-center justify-center flex-auto-fill";

        const shader = this.shader;
        const isNewShader = ( shader.uid === "EMPTY_ID" );

        // Add Shader data
        this._createShaderDataView = async () =>
        {
            const ownProfile = this.fs.user && ( shader.authorId === this.fs.getUserId() );
            const originalShader = shader.originalId ? await ShaderHub.getShaderById( shader.originalId ) : null;

            // Clear
            shaderDataArea.root.innerHTML = "";

            const shaderDataContainer = LX.makeContainer( [`100%`, "100%"], "p-6 flex flex-col gap-2 rounded-xl bg-card overflow-scroll overflow-x-hidden", "", shaderDataArea );
            const shaderNameAuthorOptionsContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-row", `
                <div class="flex flex-col gap-1">
                    <div class="flex flex-row items-center">
                        ${ ( ownProfile || isNewShader ) ? LX.makeIcon("Edit", { svgClass: "mr-2 cursor-pointer hover:text-foreground" } ).innerHTML : "" }
                        <div class="text-foreground text-lg font-semibold">${ shader.name }</div>
                    </div>
                    ${ isNewShader ? '' : `<div class="text-muted-foreground text-sm">Created by ${ !shader.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shader.authorId }")' class='hub-link font-medium'>` : `` }<span>${ shader.author }</span>${ !shader.anonAuthor ? "</a>" : "" } on ${ shader.creationDate }
                    ${ originalShader ? `(remixed from <a onclick='ShaderHub.openShader("${ shader.originalId }")' class='hub-link font-medium'>${ originalShader.name }</a> by <a onclick='ShaderHub.openProfile("${ originalShader.authorId }")' class='hub-link font-medium'>${ originalShader.author }</a>)` : `` } ` }
                    </div>
                </div>
            `, shaderDataContainer );

            // Dditable shader name
            const editButton = shaderNameAuthorOptionsContainer.querySelector( "svg" );
            if( editButton )
            {
                const iSaveName = async ( text, textDiv, input ) =>
                {
                    shader.name = text.substring( 0, 64 ); // CAP TO 64 chars
                    textDiv.innerText = shader.name;
                    input.root.replaceWith( textDiv );
                    this._editingName = false;

                    let r = await ShaderHub.shaderExists();
                    if( r && r.name !== shader.name )
                    {
                        await this.fs.updateDocument( FS.SHADERS_COLLECTION_ID, r[ "$id" ], {
                            "name": shader.name
                        } );
                        Utils.toast( `✅ Shader updated`, `Shader: ${ r.name } by ${ this.fs.user.name }` );
                    }
                };

                editButton.addEventListener( "click", (e) => {
                    if( this._editingName ) return;
                    e.preventDefault();
                    const textDiv = e.target.parentElement.children[ 1 ]; // get non-editable text
                    const input = new LX.TextInput( null, textDiv.textContent, async ( v ) => {
                        iSaveName( v, textDiv, input );
                    }, { inputClass: "text-foreground text-lg font-semibold", pattern: LX.buildTextPattern( { minLength: 3 } ) } );
                    textDiv.replaceWith( input.root );
                    LX.doAsync( () => input.root.focus() );
                    this._editingName = true;
                } )
            }

            const shaderOptions = LX.makeContainer( [`auto`, "auto"], "ml-auto flex flex-row p-1 gap-1 self-start content-center items-center", ``, shaderNameAuthorOptionsContainer );
            const editable  = ( ownProfile || isNewShader );

            if( this.fs.user )
            {
                const shaderOptionsButton = new LX.Button( null, "ShaderOptions", async () => {

                    const result    = await ShaderHub.shaderExists();
                    
                    let dmOptions = [];

                    if( editable )
                    {
                        dmOptions.push(
                            mobile ? 0 : { name: "Save Shader", icon: "Save", callback: () => ShaderHub.saveShader( result ) },
                            ( isNewShader || mobile ) ? 0 : { name: "Settings", icon: "Settings", callback: () => this.openShaderSettingsDialog( result ) }
                        );

                        if( result )
                        {
                            dmOptions.push(
                                mobile ? 0 : { name: "Update Preview", icon: "ImageUp", callback: () => ShaderHub.updateShaderPreview( shader.uid, true ) },
                            );
                        }
                    }
                    else
                    {
                        dmOptions.push( mobile ? 0 : { name: "Remix Shader", icon: "GitFork", disabled: !( result.remixable ?? true ), callback: () => ShaderHub.remixShader() } );
                    }

                    dmOptions.push(
                        !result ? 0 : { name: "Share", icon: "Share2", callback: () => this.openShareiFrameDialog( result ) }
                    );

                    if( editable && result )
                    {
                        dmOptions.push(
                            mobile ? 0 : null,
                            { name: "Delete Shader", icon: "Trash2", className: "destructive", callback: () => ShaderHub.deleteShader() },
                        );
                    }

                    dmOptions = dmOptions.filter( o => o !== 0 );

                    if( dmOptions.length )
                    {
                        LX.addDropdownMenu( shaderOptionsButton.root, dmOptions, { side: "bottom", align: "end" });
                    }

                }, { icon: "Menu" } );
                shaderOptions.appendChild( shaderOptionsButton.root );
            }
            else
            {
                LX.makeContainer( [`144px`, "auto"], "text-muted-foreground text-sm", "Login to Save or Remix", shaderOptions );
            }

            if( !isNewShader )
            {
                // Like click events
                const shaderStats = LX.makeContainer( [`auto`, "auto"], "ml-auto flex p-1 gap-1 items-center", `
                    ${ LX.makeIcon( "Heart", { svgClass: "shader-like-button lg fill-current transition duration-150 ease-in-out" } ).innerHTML } <span></span>
                ` );
                shaderOptions.prepend( shaderStats );
    
                const likeSpan = shaderStats.querySelector( "span" );
                const likeButton = shaderOptions.querySelector( "svg.shader-like-button" );
                likeButton.classList.add( "hover:text-orange-600", "cursor-pointer" );
    
                LX.addSignal( "@on_like_changed", ( target, likeData ) => {
                    const [ likesCount, alreadyLiked ] = likeData;
                    likeSpan.innerHTML = likesCount;
                    likeButton.classList.toggle( "text-orange-600", alreadyLiked );
                } );

                // Like action
                if( !this.fs.user )
                {
                    likeButton.title = "Like Shader";
                    LX.asTooltip( likeButton, likeButton.title );
                    likeButton.addEventListener( "click", (e) => {
                        e.preventDefault();
                       
                        if( this._lastOpenedDialog )
                        {
                            this._lastOpenedDialog.close();
                        }

                        const dialog = new LX.Dialog( null, ( p ) => {
                            p.root.className = LX.mergeClass( p.root.className, 'pad-2xl flex flex-col gap-2' );
                            LX.makeContainer( [ '100%', '100%' ], 'text-lg font-medium text-foreground p-2', `Login to like this shader.`, p );
                            p.addButton( null, 'Close', () => {
                                dialog.destroy();
                            }, { buttonClass: 'h-8 ghost' } );
                        }, { modal: true } );

                        this._lastOpenedDialog = dialog;
                    } );
                }
                else if( !ownProfile )
                {
                    likeButton.title = "Like Shader";
                    LX.asTooltip( likeButton, likeButton.title );
                    likeButton.addEventListener( "click", (e) => {
                        e.preventDefault();
                        ShaderHub.onShaderLike();
                    } );
                }
                // Check likes
                else
                {
                    likeButton.title = "Check Likes";
                    LX.asTooltip( likeButton, likeButton.title );
                    likeButton.addEventListener( "click", (e) => {
                        e.preventDefault();
                        this.openCurrentShaderLikesDialog( shader );
                    } );
                }
            }

            // Shader tags
            {
                if( editable || shader.tags.length )
                {
                    const tags = new LX.Tags( null, "", async (v) => {
                    
                        shader.tags = v;

                        let r = await ShaderHub.shaderExists();
                        if( r )
                        {
                            await this.fs.updateDocument( FS.SHADERS_COLLECTION_ID, r[ "$id" ], {
                                "tags": shader.tags
                            } );
                            Utils.toast( `✅ Shader updated`, `Shader: ${ r.name } by ${ this.fs.user.name }` );
                        }
                        
                    }, { disabled: !editable, tagClass: 'text-xs' } );
                    tags.set( shader.tags );
                    shaderDataContainer.appendChild( tags.root );
                }
            }

            // Editable description
            if( editable || ( shader.description ?? '' ).length )
            {
                const descContainer = LX.makeContainer( [`auto`, "auto"], "text-foreground mt-2 flex flex-row items-center", `
                    <div class="w-auto self-start">${ editable ? LX.makeIcon("Edit", { svgClass: "mr-3 cursor-pointer hover:text-foreground" } ).innerHTML : "" }</div>
                    <div class="desc-content w-full text-sm break-all">${ shader.description }</div>
                    `, shaderDataContainer );

                const editButton = descContainer.querySelector( "svg" );
                if( editButton )
                {
                    const iSaveDescription = async ( text, textDiv, input ) =>
                    {
                        shader.description = Utils.formatMD( text );
                        textDiv.innerHTML = shader.description;
                        input.root.replaceWith( textDiv );
                        this._editingDescription = false;

                        let r = await ShaderHub.shaderExists();
                        if( r && r.description !== shader.description )
                        {
                            await this.fs.updateDocument( FS.SHADERS_COLLECTION_ID, r[ "$id" ], {
                                "description": shader.description
                            } );
                            Utils.toast( `✅ Shader updated`, `Shader: ${ r.name } by ${ this.fs.user.name }` );
                        }
                    };

                    editButton.addEventListener( "click", (e) => {
                        if( this._editingDescription ) return;
                        e.preventDefault();
                        const textDiv = descContainer.querySelector( ".desc-content" );
                        const input = new LX.TextArea( null, Utils.unformatMD( textDiv.innerHTML ), async (v) => {
                            iSaveDescription( v, textDiv, input );
                        }, { resize: false, placeholder: "Enter your shader description here", className: "w-full h-full", inputClass: "bg-accent/50! h-full" , fitHeight: true } );
                        textDiv.replaceWith( input.root );
                        LX.doAsync( () => input.root.focus() );
                        this._editingDescription = true;
                    } );
                }
            }

            if( !isNewShader )
            {
                // Comments
                {
                    const canComment = this.fs.user && !isNewShader;
                    const commentsContainer = LX.makeContainer( [`auto`, "auto"], "text-foreground mt-2 flex flex-col gap-2", "", shaderDataContainer );

                    const refreshComments = async () =>
                    {
                        const shaderComments = await this.fs.listDocuments( FS.INTERACTIONS_COLLECTION_ID, [
                            Query.equal( "type", [ "comment", "comment-reply" ] ),
                            Query.equal( "shader_id", shader.uid ),
                            Query.limit( 300 ),
                            Query.orderDesc( "$createdAt" )
                        ] );
                        commentsContainer.innerHTML = `Comments (${ shaderComments.total })`;

                        if( canComment )
                        {
                            const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", this.fs.getUserId() ) ] );
                            const dbUser = users.documents[ 0 ];
                            const avatar = new LX.Avatar({
                                imgSource: dbUser.avatar,
                                fallback: dbUser.user_name[ 0 ].toUpperCase(),
                                className: 'mx-2 flex-auto-keep mt-1'
                            });

                            const newCommentItem = LX.makeContainer( [`100%`, "auto"], "flex flex-row mt-2 p-2 gap-2 bg-muted/75 rounded-lg items-start content-center", `
                                ${ avatar.root.outerHTML }
                            `, commentsContainer );

                            const commentInput = new LX.TextArea( null, "", null, { placeholder: "Add a comment...", className: "flex w-full flex-auto-fill", inputClass: "bg-background/50!", fitHeight: true } );
                            newCommentItem.appendChild( commentInput.root );
                            const submitButton = new LX.Button( null, "SubmitComment", async () => {
                                const commentText = Utils.formatMD( commentInput.value().trim() );
                                if( commentText.length === 0 ) return;
                                await ShaderHub.saveComment( shader.uid, commentText );
                                refreshComments();
                            }, { className: "flex-auto-keep", buttonClass: "primary self-start", icon: "Send", title: "Submit Comment" } );
                            newCommentItem.appendChild( submitButton.root );
                        }

                        if( shaderComments.total > 0 )
                        {
                            const authorIds = Array.from( new Set( shaderComments.documents.map( c => c["author_id"] ) ) );
                            const usersWithComments = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorIds ) ] );
                            const revReplies = LX.deepCopy( shaderComments.documents ).reverse();

                            for( const comment of shaderComments.documents )
                            {
                                if( comment["type"] !== "comment" )
                                {
                                    continue;
                                }

                                const commentAuthorId = comment[ "author_id" ];
                                const dbUser = usersWithComments.documents.find( u => u["user_id"] === commentAuthorId );
                                const commentAuthorName = dbUser.user_name;
                                const avatar = new LX.Avatar({
                                    imgSource: dbUser.avatar,
                                    fallback: commentAuthorName[ 0 ].toUpperCase(),
                                    className: 'mx-2 flex-auto-keep'
                                });

                                let commentText = ( comment[ "text" ] ?? "" );

                                const regex = /(^|\s)@([a-zA-Z0-9._]+)/g;
                                const users = [ ...commentText.matchAll(regex)];
                                if( users.length )
                                {
                                    for (const m of users )
                                    {
                                        const dbMentionedUsers = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_name", m[2] ) ] );
                                        if( dbMentionedUsers.total === 0 ) continue;
                                        commentText = commentText.substring( 0, m.index ) + commentText.substring( m.index ).replace(m[0],
                                        ` <span onclick='ShaderHub.openProfile("${ dbMentionedUsers.documents[0].user_id }")' class="hub-mention">${m[0]}</span>` );   
                                    }
                                }

                                const commentDate = ( new Date( comment[ "$createdAt" ] ) ).toLocaleDateString( undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' } );
                                const commentItemContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-col bg-muted/75 rounded-lg", "", commentsContainer );
                                const commentItem = LX.makeContainer( [`100%`, "auto"], "flex flex-row p-2 gap-2 items-center content-center", `
                                    ${ avatar.root.outerHTML }
                                    <div class="flex flex-col gap-1 flex-auto-fill">
                                        <div class="flex flex-row gap-2 items-center">
                                            <div class="text-sm font-medium">${ `<a onclick='ShaderHub.openProfile("${ commentAuthorId }")' class='hub-link font-medium'>${ commentAuthorName }</a>` }</div>
                                            <div class="text-xs text-muted-foreground">${ commentDate }</div>
                                        </div>
                                        <div class="text-sm w-full break-all">${ commentText }</div>
                                    </div>
                                `, commentItemContainer );

                                if( canComment )
                                {
                                    const commentActionsButton = new LX.Button( null, "ActionsButton", async () => {
        
                                        const options = [
                                            {
                                                name: "Reply",
                                                icon: "Reply",
                                                callback: () => {
                                                    document.querySelectorAll( ".shader-comment-reply-item" ).forEach( e => e.remove() );
            
                                                    const newReplyItem = LX.makeContainer( [`100%`, "auto"], "shader-comment-reply-item flex flex-row mt-2 p-2 gap-2 bg-muted/75 rounded-lg items-start content-center",
                                                        ``, commentItemContainer );
                    
                                                    const replyInput = new LX.TextArea( null, "", (v) => {
                                                        if( v.length === 0 ) newReplyItem.remove();
                                                    }, { placeholder: `Replying to ${commentAuthorName}...`, className: "flex w-full flex-auto-fill", inputClass: "bg-background/50!", fitHeight: true } );
                                                    newReplyItem.appendChild( replyInput.root );
                                                    const submitButton = new LX.Button( null, "SubmitReply", async () => {
                                                        const replyText = Utils.formatMD( replyInput.value().trim() );
                                                        if( replyText.length === 0 ) return;
                                                        
                                                        // Add reply interaction to DB
                                                        {
                                                            await this.fs.createDocument( FS.INTERACTIONS_COLLECTION_ID, {
                                                                type: "comment-reply",
                                                                shader_id: shader.uid,
                                                                author_id: this.fs.getUserId(),
                                                                comment_id: comment[ "$id" ], 
                                                                text: replyText
                                                            } );
                                                        }
                                                        
                                                        refreshComments();
                                                    }, { buttonClass: "primary self-start", icon: "Send", title: "Submit Reply" } );
                                                    newReplyItem.appendChild( submitButton.root );
                                                }
                                            }
                                        ]

                                        if( this.fs.getUserId() === commentAuthorId )
                                        {
                                            options.push( null, {
                                                name: "Delete",
                                                icon: "Trash2",
                                                className: "destructive",
                                                callback: async () => {
                                                    // Remove comment interaction from DB
                                                    await this.fs.deleteDocument( FS.INTERACTIONS_COLLECTION_ID, comment[ "$id" ] );
                                                    // Remove DOM el
                                                    commentItemContainer.remove();
                                                }
                                            });
                                        }

                                        LX.addDropdownMenu( commentActionsButton.root, options, { side: "bottom", align: "end" });
        
                                    }, { buttonClass: "h-7 p-0 ghost self-center ml-auto flex-auto-keep", icon: "EllipsisVertical" } );
                                    commentItem.appendChild( commentActionsButton.root );
                                }

                                const repliesContainer = LX.makeContainer( [`100%`, "auto"], "flex flex-col bg-accent/50! rounded-b-lg", "", commentItemContainer );

                                // Add replies to Comment
                                for( const reply of revReplies )
                                {
                                    // Discard replies to other comments!
                                    if( ( reply["type"] !== "comment-reply" ) || ( reply["comment_id"] !== comment["$id"] ) )
                                    {
                                        continue;
                                    }

                                    let replyText = ( reply[ "text" ] ?? "" );
                                    const regex = /(^|\s)@([a-zA-Z0-9._]+)/g;
                                    const users = [ ...replyText.matchAll(regex)];
                                    if( users.length )
                                    {
                                        for (const m of users )
                                        {
                                            const dbMentionedUsers = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_name", m[2] ) ] );
                                            if( dbMentionedUsers.total === 0 ) continue;
                                            replyText = replyText.substring( 0, m.index ) + replyText.substring( m.index ).replace(m[0],
                                            ` <span onclick='ShaderHub.openProfile("${ dbMentionedUsers.documents[0].user_id }")' class="hub-mention">${m[0]}</span>` );   
                                        }
                                    }

                                    const replyAuthorId = reply[ "author_id" ];
                                    const dbUser = usersWithComments.documents.find( u => u["user_id"] === replyAuthorId );
                                    const replyAuthorName = dbUser.user_name;
                                    const avatar = new LX.Avatar({
                                        imgSource: dbUser.avatar,
                                        fallback: replyAuthorName[ 0 ].toUpperCase(),
                                        className: 'mx-2 flex-auto-keep'
                                    });
                                    const replyDate = ( new Date( reply[ "$createdAt" ] ) ).toLocaleDateString( undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: 'numeric' } );
                                    const replyItem = LX.makeContainer( [`95%`, "auto"], "flex flex-row p-2 gap-2 items-center content-center ml-auto", `
                                        ${ LX.makeIcon( "CornerDownRight", { svgClass: "text-muted-foreground" } ).innerHTML }
                                        ${ avatar.root.outerHTML }
                                        <div class="flex flex-col gap-1 flex-auto-fill">
                                            <div class="flex flex-row gap-2 items-center">
                                                <div class="text-sm font-medium">${ `<a onclick='ShaderHub.openProfile("${ replyAuthorId }")' class='hub-link font-medium'>${ replyAuthorName }</a>` }</div>
                                                <div class="text-xs text-muted-foreground">${ replyDate }</div>
                                            </div>
                                            <div class="text-sm w-full break-all">${ replyText }</div>
                                        </div>
                                    `, repliesContainer );

                                    if( canComment )
                                    {
                                        const commentActionsButton = new LX.Button( null, "ActionsButton", async () => {
            
                                            const options = [];
        
                                            if( this.fs.getUserId() === replyAuthorId )
                                            {
                                                options.push( {
                                                    name: "Delete",
                                                    icon: "Trash2",
                                                    className: "destructive",
                                                    callback: async () => {
                                                        // Remove reply interaction from DB
                                                        await this.fs.deleteDocument( FS.INTERACTIONS_COLLECTION_ID, reply[ "$id" ] );
                                                        // Remove DOM el
                                                        replyItem.remove();
                                                    }
                                                } );
                                            }
        
                                            LX.addDropdownMenu( commentActionsButton.root, options, { side: "bottom", align: "end" });
            
                                        }, { buttonClass: "h-7 p-0 ghost self-center ml-auto flex-auto-keep", icon: "EllipsisVertical" } );
                                        replyItem.appendChild( commentActionsButton.root );
                                    }
                                }
                            }
                        }
                    }

                    await refreshComments();
                }
            }
        }

        await this._createShaderDataView();

        // Add shader visualization UI
        {
            let [ canvasArea, canvasControlsArea ] = graphicsArea.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
            canvasArea.root.className += " bg-none";
            canvasControlsArea.root.className += " px-2 rounded-b-xl bg-card";

            const canvas = this.makeGPUCanvas();
            canvasArea.attach( canvas );

            const panel = canvasControlsArea.addPanel( { className: "flex flex-row" } );
            panel.sameLine();
            panel.addButton( null, "ResetTime", () => ShaderHub.onShaderTimeReset(), { className: 'flex-auto-keep', icon: "SkipBack", title: "Reset time", tooltip: true } );
            panel.addButton( null, "PauseTime", () => ShaderHub.onShaderTimePaused(), { className: 'flex-auto-keep', icon: "Pause", title: "Pause/Resume", tooltip: true, swap: "Play" } );
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
                const container = LX.makeContainer( ["auto", "auto"], "flex flex-row ml-auto" );
                this._recordButton = new LX.Button( null, "RecordButton", ( name, event ) => {
                    const iButton = this._recordButton.root.querySelector( "button" );
                    iButton.classList.remove( "bg-none", "lexbutton" );
                    iButton.classList.add( "bg-destructive", "hover:bg-destructive", "rounded-lg", "border-none" );
                    this.allowCapture = false;
                    ShaderHub.startCapture( exportOptions );
                }, { icon: "Video", className: "p-0", buttonClass: "outline record-button", title: "Record", tooltip: true } );
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
                                return { name: `${ checked ? LX.makeIcon( "Circle", { svgClass: "2xs fill-current inline-flex! mr-2" } ).innerHTML : "" }${ o }`, callback: (v) => iUpdateExportOptions( "format", v ) };
                            } )
                        },
                        {
                            name: "Frames",
                            icon: "Film",
                            submenu: [ 60, 120, 180, 240, 300 ].map( o => {
                                const checked = ( exportOptions[ "frames" ] === `${ o }` );
                                return { name: `${ checked ? LX.makeIcon( "Circle", { svgClass: "2xs fill-current inline-flex! mr-2" } ).innerHTML : "" }${ o }`, callback: (v) => iUpdateExportOptions( "frames", v ) };
                            } )
                        },
                        {
                            name: "Frame Rate",
                            icon: "Gauge",
                            submenu: [ 10, 15, 30, 60 ].map( o => {
                                const checked = ( exportOptions[ "framerate" ] === `${ o }` );
                                return { name: `${ checked ? LX.makeIcon( "Circle", { svgClass: "2xs fill-current inline-flex! mr-2" } ).innerHTML : "" }${ o }`, callback: (v) => iUpdateExportOptions( "framerate", v ) };
                            } )
                        },
                    ], { side: "bottom", align: "end" });
                }, { icon: "ChevronDown", className: "p-0", buttonClass: "bg-none"});
                container.appendChild( b.root );
                panel.addContent( null, container );
                panel.addButton( null, "Fullscreen", () => ShaderHub.requestFullscreen(), { icon: "Fullscreen", title: "Fullscreen", tooltip: true } );
                panel.endLine( "items-center h-full ml-auto" );
            }

            await ShaderHub.onShaderEditorCreated( shader, canvas );

            if( editor )
            {
                LX.doAsync( () => editor.charWidth = editor._measureChar(), 400 );
            }
        }
    },

    async makeProfileView( userID )
    {
        let [ topArea, bottomArea ] = this.area.split({ type: "vertical", sizes: ["calc(100% - 48px)", null], resize: false });
        topArea.root.parentElement.classList.add( "hub-background" )
        topArea.root.className += " p-6 hub-background-blur overflow-scroll";
        bottomArea.root.className += " items-center content-center";

        this._makeFooter( bottomArea );

        const users = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", userID ) ] );
        if( users.total === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-2xl font-medium justify-center text-center", "No user found.", topArea );
            return;
        }

        const user = users.documents[ 0 ];
        const userName = user[ "user_name" ];

        // Likes are only shown for the active user, they are private!
        const ownProfile = this.fs.user && ( userID === this.fs.getUserId() );
        const usersDocuments = await this.fs.listDocuments( FS.USERS_COLLECTION_ID );
        const PAGE_LIMIT = 8;

        const avatar = new LX.Avatar({ imgSource: user["avatar"], fallback: userName[0].toUpperCase(), className: `size-12 [&_span]:text-xl [&_span]:leading-12` });
        const infoContainer = LX.makeContainer( ["100%", "auto"], "flex flex-col gap-4 p-2 my-8 justify-center", `
            <div class="avatar-container flex flex-row gap-3 text-3xl font-bold content-center items-center">
                ${ user[ "display_name" ] ? `${ user[ "display_name" ] } <span class="text-xl font-normal text-muted-foreground">(${ userName })</span>` : userName }
            </div>
            <div class="flex flex-row gap-2">
                <div style="max-width: 600px; overflow-wrap: break-word;" class="desc-content text-lg font-medium text-card-foreground">${ user[ "description" ] ?? "" }</div>
            </div>
        `, topArea );

        const avatarContainer = infoContainer.querySelector( ".avatar-container" );
        avatarContainer.prepend( avatar.root );

        const tabs = topArea.addTabs( { parentClass: 'bg-transparent', sizes: [ 'auto', 'auto' ], contentClass: 'p-4 my-2 bg-transparent rounded-xl border-color h-auto!' } );

        document.title = `${ userName } - ShaderHub`;

        // Shader list
        {
            const shadersContainer = LX.makeContainer( [ null, 'auto' ], 'flex flex-col relative p-1 pt-0 rounded-lg overflow-hidden' );
            tabs.add( 'Shaders', shadersContainer, { selected: true, onSelect: ( event, name ) => {
                document.title = `${ userName } - ShaderHub`;
            } } );

            const listHeader = LX.makeContainer( [ "100%", 'auto' ], 'flex flex-row', '', shadersContainer );

            const searchShaderInput = new LX.TextInput(null, '', v => {
                this._refreshOwnShaders( v );
            }, { placeholder: "Filter shaders...", width: "256px" });
            listHeader.appendChild( searchShaderInput.root );

            // Add pagination for shader list
            const paginator = new LX.Pagination({
                className: "ml-auto",
                maxButtons: 4,
                useEllipsis: true,
                alwaysShowEdges: false,
                xallowChangeItemsPerPage: true,
                onChange: (page) => {
                    this._refreshOwnShaders( undefined, page.toString() );
                }
            });
            listHeader.appendChild( paginator.root );

            const listContent = LX.makeContainer( [ "100%", 'auto' ], 'flex p-1 my-2', '', shadersContainer );

            this._refreshOwnShaders = async ( filterSearch, filterPage ) => {

                listContent.innerHTML = "";

                this._lastFilterSearch = filterSearch ?? '';
                this._lastFilteredPage = filterPage ? parseInt( filterPage ) : 1;

                const queries = [
                    Query.equal( "author_id", userID ),
                    Query.orderAsc( 'name' ),
                    Query.offset( ( this._lastFilteredPage - 1 ) * PAGE_LIMIT ),
                    Query.limit( PAGE_LIMIT )
                ];

                if( !ownProfile )
                {
                    queries.push( Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ) );
                }

                const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, queries );

                paginator.setPages( Math.ceil( result.total / PAGE_LIMIT ) );
                paginator.setPage( this._lastFilteredPage );

                const dbShaders = ShaderHub.filterShaders( result.documents, this._lastFilterSearch );
                if( dbShaders.length === 0 )
                {
                    const headerButtons = LX.makeContainer( [ "100%", "auto" ], "flex flex-col p-2 justify-center", ``, listContent );
                    LX.makeContainer( ["100%", "auto"], "mt-2 text-2xl font-medium justify-center text-center", `No shaders found.`, headerButtons );
                    const getStartedButton = new LX.Button( null, "Create a Shader", () => ShaderHub.openShader( "new" ), { className: "mt-2 place-self-center w-fit!", icon: "ChevronRight", iconPosition: "end", buttonClass: "lg primary" } );
                    headerButtons.appendChild( getStartedButton.root );
                    return;
                }

                let skeletonHtml = "";

                for( let i = 0; i < dbShaders.length; ++i )
                {
                    const shaderItem = LX.makeElement( "li", `shader-item lexskeletonpart relative bg-background-blur hover:bg-accent overflow-hidden flex flex-col h-auto`, "" );
                    const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-lg bg-background-blur hover:bg-accent border-none cursor-pointer self-center mt-2", "", shaderItem );
                    shaderPreview.style.width = "calc(100% - 1rem)";
                    shaderPreview.style.height = "calc(100% - 1rem)";
                    shaderPreview.src = "images/shader_preview.png";
                    LX.makeContainer( ["100%", "auto"], "absolute bottom-0 bg-background-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                        <div class="w-full flex flex-col gap-1">
                            <div class="w-3/4 h-3 lexskeletonpart"></div>
                            <div class="w-1/2 h-3 lexskeletonpart"></div>
                        </div>`, shaderItem );

                    skeletonHtml += shaderItem.outerHTML;
                }

                const skeleton = new LX.Skeleton( skeletonHtml );
                skeleton.root.classList.add( "grid", "shader-list", "gap-6", "justify-center" );
                listContent.appendChild( skeleton.root );

                const previewFiles = await this.fs.listFiles( [
                    Query.startsWith( "name", ShaderHub.previewNamePrefix ),
                    Query.endsWith( "name", ".png" ),
                    Query.contains( "name", dbShaders.map( d => d[ "$id" ] ) ),
                    Query.limit( PAGE_LIMIT )
                ] );

                LX.doAsync( async () => {

                    // Instead of destroying it, convert to normal container
                    skeleton.root.querySelectorAll( ".lexskeletonpart" ).forEach( i => i.classList.remove( "lexskeletonpart" ) );

                    for( let i = 0; i < dbShaders.length; ++i )
                    {
                        const document = dbShaders[ i ];
                        const uid = document[ "$id" ];
                        const name = document.name;

                        const shaderInfo = {
                            name,
                            uid,
                            likeCount: document[ "like_count" ] ?? 0,
                            public: document[ "public" ] ?? true,
                            url: await this.fs.getFileUrl( document[ "file_id" ] ),
                        };

                        const previewName = ShaderHub.getShaderPreviewName( shaderInfo.uid );
                        const previewFile = previewFiles.files.find( f => f.name === previewName );
                        if( previewFile )
                        {
                            shaderInfo.preview = await this.fs.getFileUrl( previewFile[ "$id" ] );
                        }

                        const shaderItem = skeleton.root.children[ i ];
                        const shaderPreview = shaderItem.querySelector( "img" );
                        shaderPreview.style.width = "calc(100% - 1rem)";
                        shaderPreview.src = shaderInfo.preview ?? "images/shader_preview.png";
                        shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                        shaderItem.querySelector( "div" ).remove();
                        const shaderDesc = LX.makeContainer( ["100%", "auto"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                            <div class="w-full flex-auto-fill overflow-hidden">
                                <div class="text-base sm:text-lg font-bold"><span class="truncate max-w-full block">${ shaderInfo.name }</span></div>
                            </div>
                            <div class="flex flex-row gap-2 flex-auto-keep items-center">
                                ${ ownProfile ? LX.makeIcon( shaderInfo.public ? "Eye" : "EyeOff", { svgClass: "viz-icon text-card-foreground" } ).innerHTML : "" }
                                <div class="flex flex-row gap-1 items-center">
                                    ${ LX.makeIcon( "Heart", { svgClass: "fill-current text-card-foreground" } ).innerHTML }
                                    <span>${ shaderInfo.likeCount ?? 0 }</span>
                                </div>
                                ${ ownProfile ? `<span class="h-4 mx-2 border-right border-color text-muted-foreground self-center items-center"></span>` : "" }
                                ${ ownProfile ? LX.makeIcon( "EllipsisVertical", { svgClass: "shader-prof-opt text-card-foreground cursor-pointer" } ).innerHTML : "" }
                            </div>`, shaderItem );

                        let vizIcon = shaderDesc.querySelector( ".viz-icon" );
                        const optButton = shaderDesc.querySelector( ".shader-prof-opt" );
                        if( optButton )
                        {
                            optButton.addEventListener( "click", ( e ) => {
                                new LX.DropdownMenu( optButton, [
                                    { name: shaderInfo.public ? "Make Private" : "Make Public", icon: shaderInfo.public ? "EyeOff" : "Eye", callback: async () => {
                                        shaderInfo.public = !shaderInfo.public;
                                        const newIcon = LX.makeIcon( shaderInfo.public ? "Eye" : "EyeOff", { svgClass: "viz-icon text-card-foreground" } ).querySelector( "svg" );
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
                                    { name: "Delete", icon: "Trash2", className: "destructive", callback: () => ShaderHub.deleteShader( { uid, name } ) },
                                ], { side: "bottom", align: "end" });
                            } );
                        }

                        shaderPreview.addEventListener( "mousedown", e => e.preventDefault() );
                        shaderPreview.addEventListener( "mouseup", ( e ) => {
                            ShaderHub.openShader( shaderInfo.uid, e );
                        } );
                    }
                }, 10 );
            }

            await this._refreshOwnShaders();
        }

        // Show likes only for account owner
        if( !ownProfile )
        {
            return;
        }

        // Likes
        {
            let likesOpened = false;
            const likesContainer = LX.makeContainer( [ null, 'auto' ], 'flex flex-col relative p-1 pt-0 rounded-lg overflow-hidden' );
            tabs.add( 'Likes', likesContainer, { xselected: true, onSelect: async ( event, name ) => {
                document.title = `${ userName } Likes - ShaderHub`;

                if( likesOpened )
                {
                    return;
                }

                likesOpened = true;

                const listHeader = LX.makeContainer( [ "100%", 'auto' ], 'flex flex-row', '', likesContainer );

                const searchShaderInput = new LX.TextInput(null, '', v => {
                    this._refreshLikedShaders( v );
                }, { placeholder: "Filter shaders...", width: "256px" });
                listHeader.appendChild( searchShaderInput.root );

                const paginator = new LX.Pagination({
                    className: "ml-auto",
                    maxButtons: 4,
                    useEllipsis: true,
                    alwaysShowEdges: false,
                    xallowChangeItemsPerPage: true,
                    onChange: (page) => {
                        this._refreshLikedShaders( undefined, page.toString() );
                    }
                });
                listHeader.appendChild( paginator.root );

                const listContent = LX.makeContainer( [ "100%", 'auto' ], 'flex p-1 my-2', '', likesContainer );

                this._refreshLikedShaders = async ( filterSearch, filterPage ) => {

                    listContent.innerHTML = "";

                    this._lastFilterSearch = filterSearch ?? '';
                    this._lastFilteredPage = filterPage ? parseInt( filterPage ) : 1;

                    const queries = [
                        Query.or( [ Query.equal( "public", true ), Query.isNull( "public" ) ] ),
                        Query.offset( ( this._lastFilteredPage - 1 ) * PAGE_LIMIT ),
                        Query.limit( PAGE_LIMIT )
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
                    else
                    {
                        LX.makeContainer( ["100%", "auto"], "mt-2 text-2xl font-medium justify-center text-center", `
                            No liked shaders found. <br>
                            Start browsing now to discover new shaders!`, likesContainer );
                        return;
                    }

                    const result = await this.fs.listDocuments( FS.SHADERS_COLLECTION_ID, queries );

                    paginator.setPages( Math.ceil( result.total / PAGE_LIMIT ) );
                    paginator.setPage( this._lastFilteredPage );

                    let dbShaders = ShaderHub.filterShaders( result.documents, this._lastFilterSearch );
                    if( dbShaders.length === 0 )
                    {
                        LX.makeContainer( ["100%", "auto"], "mt-2 text-2xl font-medium justify-center text-center", "No shaders found.", listContent );
                        return;
                    }

                    let skeletonHtml = "";

                    for( let i = 0; i < dbShaders.length; ++i )
                    {
                        const shaderItem = LX.makeElement( "li", `shader-item lexskeletonpart relative bg-background-blur hover:bg-accent overflow-hidden flex flex-col h-auto`, "" );
                        const shaderPreview = LX.makeElement( "img", "opacity-0 rounded-lg bg-background-blur hover:bg-accent border-none cursor-pointer self-center mt-2", "", shaderItem );
                        shaderPreview.style.width = "calc(100% - 1rem)";
                        shaderPreview.style.height = "calc(100% - 1rem)";
                        shaderPreview.src = "images/shader_preview.png";
                        LX.makeContainer( ["100%", "auto"], "absolute bottom-0 bg-background-blur flex flex-row rounded-b-lg gap-6 p-4 select-none", `
                            <div class="w-full flex flex-col gap-1">
                                <div class="w-3/4 h-3 lexskeletonpart"></div>
                                <div class="w-1/2 h-3 lexskeletonpart"></div>
                            </div>`, shaderItem );

                        skeletonHtml += shaderItem.outerHTML;
                    }

                    const skeleton = new LX.Skeleton( skeletonHtml );
                    skeleton.root.classList.add( "grid", "shader-list", "gap-6", "justify-center" );
                    listContent.appendChild( skeleton.root );

                    const previewFiles = await this.fs.listFiles( [
                        Query.startsWith( "name", ShaderHub.previewNamePrefix ),
                        Query.endsWith( "name", ".png" ),
                        Query.contains( "name", dbShaders.map( d => d[ "$id" ] ) ),
                        Query.limit( PAGE_LIMIT )
                    ] );

                    LX.doAsync( async () => {

                        // Instead of destroying it, convert to normal container
                        skeleton.root.querySelectorAll( ".lexskeletonpart" ).forEach( i => i.classList.remove( "lexskeletonpart" ) );

                        const indexMap = new Map( likes.map( ( id, i ) => [ id, i ] ) );
                        dbShaders = dbShaders.sort( ( a, b ) => indexMap.get( a ) - indexMap.get( b ) ).reverse();

                        for( let i = 0; i < dbShaders.length; ++i )
                        {
                            const document = dbShaders[ i ];
                            const name = document.name;

                            const shaderInfo = {
                                name,
                                uid: document[ "$id" ],
                                likeCount: document[ "like_count" ] ?? 0,
                            };

                            const authorId = document[ "author_id" ];
                            if( authorId )
                            {
                                const userDocument = usersDocuments.documents.find( d => d[ "user_id" ] === authorId );
                                const author = userDocument[ "user_name" ];
                                shaderInfo.author = author;
                                shaderInfo.authorId = authorId;
                            }
                            else
                            {
                                shaderInfo.author = document[ "author_name" ];
                                shaderInfo.anonAuthor = true;
                            }

                            const previewName = ShaderHub.getShaderPreviewName( shaderInfo.uid );
                            const previewFile = previewFiles.files.find( f => f.name === previewName );
                            if( previewFile )
                            {
                                shaderInfo.preview = await this.fs.getFileUrl( previewFile[ "$id" ] );
                            }

                            const shaderItem = skeleton.root.children[ i ];
                            const shaderPreview = shaderItem.querySelector( "img" );
                            shaderPreview.style.width = "calc(100% - 1rem)";
                            shaderPreview.src = shaderInfo.preview ?? "images/shader_preview.png";
                            shaderPreview.onload = () => shaderPreview.classList.remove( "opacity-0" );
                            shaderItem.querySelector( "div" ).remove();
                            const shaderDesc = LX.makeContainer( ["100%", "auto"], "flex flex-row rounded-b-lg gap-6 p-4 items-center select-none", `
                                <div class="w-full">
                                    <div class="text-lg font-bold"><span>${ shaderInfo.name }</span></div>
                                    <div class="text-sm font-light">by ${ !shaderInfo.anonAuthor ? `<a onclick='ShaderHub.openProfile("${ shaderInfo.authorId }")' class='hub-link font-medium'>` : "" }<span>${ shaderInfo.author }</span>${ !shaderInfo.anonAuthor ? "</a>" : "" }</div>
                                </div>
                                <div class="flex flex-row gap-1 items-center">
                                    ${ LX.makeIcon( "Heart", { svgClass: "fill-current text-card-foreground" } ).innerHTML }
                                    <span>${ shaderInfo.likeCount ?? 0 }</span>
                                </div>`, shaderItem );

                            shaderPreview.addEventListener( "mousedown", e => e.preventDefault() );
                            shaderPreview.addEventListener( "mouseup", ( e ) => {
                                ShaderHub.openShader( shaderInfo.uid, e );
                            } );
                        }
                    }, 10 );
                }

                await this._refreshLikedShaders();
            } } );
        }

        // Account
        {
            const accountContainer = LX.makeContainer( [ null, 'auto' ], 'flex flex-col relative p-1 pt-0 rounded-lg overflow-hidden' );
            tabs.add( 'Account', accountContainer, { xselected: true, onSelect: ( event, name ) => {} } );

            const content = LX.makeContainer( [ "100%", 'auto' ], 'flex flex-col md:flex-row gap-2 p-1 my-2', '', accountContainer );

            // notifications
            {
                const p = new LX.Panel({ className: "rounded-xl border-color" });
                p.addTitle( "Notifications" );
                p.addToggle( "Comments", false, () => {}, { className: "primary", disabled: true, nameWidth: "70%" } );
                p.addToggle( "Comment Replies", false, () => {}, { className: "primary", disabled: true, nameWidth: "70%" } );
                p.addToggle( "Likes", false, () => {}, { className: "primary", disabled: true, nameWidth: "70%" } );
                p.addToggle( "New Followers", false, () => {}, { className: "primary", disabled: true, nameWidth: "70%" } );
                p.addToggle( "Follower New Shaders", false, () => {}, { className: "primary", disabled: true, nameWidth: "70%" } );
                p.addSeparator();
                p.addButton( null, "Save Changes", () => {
                    // TODO
                }, { disabled: true, className: "place-self-center w-fit!", buttonClass: "primary" } );
                content.appendChild( p.root );
            }

            // profile
            {
                let publicProfile = true;
                let userAvatar = user.avatar ?? "", userDescription = user.description ?? "", userDisplayName = user.display_name ?? "";

                const p = new LX.Panel({ className: "rounded-xl border-color" });
                p.addTitle( "Profile" );
                // p.addToggle( "Public", publicProfile, (v) => {
                //     publicProfile = v;
                // }, { className: "primary", nameWidth: "70%", disabled: true, skipReset: true } );
                p.addText( "Avatar", userAvatar, (v) => {
                    userAvatar = v;
                }, { skipReset: true, placeholder: `Enter a URL (optional)` } );
                p.addText( "Display Name", userDisplayName, (v) => {
                    userDisplayName = v;
                }, { skipReset: true, placeholder: `Your full name (optional)` } );
                p.addTextArea( "About", userDescription, (v) => {
                    userDescription = v;
                }, { fitHeight: true, skipReset: true, inputClass: "bg-secondary!", placeholder: `Tell us something about yourself! (optional)` } );
                p.addSeparator();
                p.addButton( null, "Save Changes", async () => {
                    if( userAvatar === user.avatar &&
                        userDescription === user.description &&
                        userDisplayName === user.display_name )
                    {
                        return;
                    }
                    const r = await this.fs.updateDocument( FS.USERS_COLLECTION_ID, user[ "$id" ], {
                        "avatar": userAvatar,
                        "description": userDescription,
                        "display_name": userDisplayName
                    } );
                    if( r )
                    {
                        user.avatar = userAvatar;
                        user.description = userDescription;
                        infoContainer.querySelector( ".desc-content" ).innerHTML = userDescription;
                        document.querySelectorAll( ".lexavatar img" ).forEach( i => i.src = userAvatar );
                        Utils.toast( `✅ Settings updated`, `User: ${ userName }` );
                    }
                }, { className: "place-self-center w-fit!", buttonClass: "primary" } );
                content.appendChild( p.root );
            }

            // account
            {
                let password = "";

                const p = new LX.Panel({ className: "rounded-xl border-color" });
                p.addTitle( "Account" );

                if( this.fs.user?.emailVerification )
                {
                    let iconStr = LX.makeIcon( "BadgeCheck", { svgClass: 'md text-inherit!' } ).innerHTML
                    p.attach( LX.badge( iconStr + "Email verified", "success m-4 flex place-self-center", { asElement: true } ) );
                }
                else
                {
                    let iconStr = LX.makeIcon( "BadgeX", { svgClass: 'md text-inherit!' } ).innerHTML
                    p.attach( LX.badge( iconStr + "Email not verified yet", "destructive m-4 flex place-self-center", { asElement: true } ) );

                    p.addButton( null, "Send email verification", async () => {
                        const url = new URL( window.location.href );
                        url.search = "";
                        const result = await this.fs.account.createEmailVerification( {
                            url: url.href + "?verifyEmail=true" // Redirect URL after recovery
                        } );
                    }, { className: "place-self-center w-fit!", buttonClass: "primary" } );
                }

                p.addSeparator();
                p.addLabel( "Change Password" );
                const formData = {
                    password: { label: "Password", value: "", type: "password" },
                    newPassword: { label: "New Password", value: "", type: "password", pattern: { minLength: Constants.PASSWORD_MIN_LENGTH, digit: true } },
                    repeatPassword: { label: "Repeat New Password", value: "", type: "password", pattern: { fieldMatchName: "newPassword" } },
                };
                const form = p.addForm( null, formData, async (value, err) => {
                    form.syncInputs(); // Force sync
                    if( err.length )
                    {
                        Utils.toast( `❌ Error`, err.map( e => `${ e.entry }: ${ e.messages.join( "\n" ) }` ).join( "\n\n" ), -1 );
                        return;
                    }
                    try {
                        const r = await this.fs.account.updatePassword( value.newPassword, value.password );
                        if( r )
                        {
                            form.root.querySelectorAll( "input[type=password]" ).forEach( t => t.value = "" );
                            form.syncInputs(); // Force sync
                            Utils.toast( `✅ Password updated!`, `User: ${ userName }` );
                        }
                    } catch( err ) {
                        console.log(err)
                        Utils.toast( `❌ Error`, err, -1 );
                    }
                }, { primaryActionName: "Update" } );
                p.addSeparator();
                p.addLabel( "This action will delete your ShaderHub account. This is irreversible!" );
                p.addText( "Password", password, (v) => {
                    password = v;
                }, { disabled: true, type: "password", skipReset: true } );
                p.addButton( "Delete Account", "Delete", async () => {
                    try {
                        // const r = await this.fs.account.updatePassword( password, password );
                        // if( r )
                        // {
                        //     // TODO
                        // }
                    } catch( err ) {
                        console.log(err)
                        Utils.toast( `❌ Error`, err, -1 );
                    }
                }, { disabled: true, buttonClass: "destructive" } );
                content.appendChild( p.root );
            }
        }
    },

    makeHelpView()
    {
        this.area.sections[ 1 ].root.classList.add( "hub-background" );
        const viewContainer = LX.makeContainer( [ "100%", "100%" ], "hub-background-blur", "", this.area );

        const header = LX.makeContainer( [ null, "200px" ], "flex flex-col gap-2 text-center items-center place-content-center", `
            <a><span class="text-lg text-muted-foreground">Documentation</span></a>
            <span class="text-4xl font-medium text-card-foreground">Get started with ShaderHub</span>
        `, viewContainer );

        const headerButtons = LX.makeContainer( [ "auto", "auto" ], "flex flex-row p-2", ``, header );
        const getStartedButton = new LX.Button( null, "Get Started", () => ShaderHub.openShader( "new" ), { buttonClass: "primary lg" } );
        headerButtons.appendChild( getStartedButton.root );

        const docMaker = new DocMaker();
        const collapsibleClass = 'my-0 bg-accent/30 hover:bg-accent/50! rounded-xl border-color cursor-pointer [&_svg]:w-5! [&_svg]:h-5!';

        const content = LX.makeContainer( [ null, "calc(100% - 200px)" ], "lexdocs-content flex flex-col gap-2 px-10 pt-4 overflow-scroll", "", viewContainer );
        docMaker.setDomTarget( content );

        docMaker.header( "Creating Shaders.", "h1", "creating-shaders" );

        docMaker.paragraph( `ShaderHub lets you create and run shaders right in your browser using WebGPU. You can write code, plug in textures or uniforms, and instantly see the results on the canvas. No setup, no downloads, just shaders that run on the web.` );
        docMaker.paragraph( `To create a new shader, simply click on the "New" button in the top menu bar. This will open a new shader editor where you can start coding your shader. The editor supports multiple passes, allowing you to create complex effects by layering different shaders together.
        Once you've written your shader code, you can compile and run it by clicking the "Run" button or using the ${ LX.makeKbd( ["Ctrl", "Space"], false, "text-base inline-block border-color px-1 rounded" ).innerHTML }/${ LX.makeKbd( ["Ctrl", "Enter"], false, "text-base inline-block border-color px-1 rounded" ).innerHTML } shortcuts.
        Once the shader is compiled, you will see the results in real-time on the canvas.` );

        docMaker.lineBreak();
        docMaker.header( "Shader Passes.", "h2", "shader-passes", { collapsable: true, className: collapsibleClass, collapsed: true, collapsableContentCallback: () => {
            docMaker.root.classList.add( 'py-4' );
            docMaker.paragraph( `ShaderHub supports multiple shader passes, which are essentially different stages of rendering that can be combined to create complex visual effects. There are 3 types of passes you can create:` );
            docMaker.bulletList( [
                `<span class='font-bold underline underline-offset-4'>Buffers</span>: Offscreen render targets that can be used to store intermediate results. You can create up to four buffer passes, which can be referenced in subsequent passes using the iChannel uniforms (iChannel0, iChannel1, etc.). This allows you to build effects step by step, using the output of one pass as the input for another.`,
                `<span class='font-bold underline underline-offset-4'>Compute</span>: A compute pass that runs independently of the render pipeline and writes directly to buffers or textures. This is useful for general-purpose GPU computations such as simulations, particle updates, procedural data generation, or precomputing values that will later be used by render or buffer passes.`,
                `<span class='font-bold underline underline-offset-4'>Common</span>: Used for shared code that can be included in other passes. This is useful for defining functions or variables that you want to reuse across multiple shader passes. You can only have one Common pass per shader.`
            ] );
            docMaker.paragraph( `To create a new pass, click on the "+" button in the editor's tab bar and select the type of pass you want to create. You can then write your shader code in the new tab that appears.` );
        } } );

        docMaker.header( "Uniforms, Textures and Sounds.", "h2", "uniforms", { collapsable: true, className: collapsibleClass, collapsed: true, collapsableContentCallback: () => {
            docMaker.root.classList.add( 'py-4' );
            docMaker.paragraph( `Uniforms are global variables that can be passed to your shader code. ShaderHub provides a set of default uniforms, such as <span class='font-bold'>iTime</span> (elapsed time), <span class='font-bold'>iResolution</span> (canvas resolution), and <span class='font-bold'>iMouse</span> (mouse position), which you can use to create dynamic effects.
                In addition to the default uniforms, you can also create custom uniforms to pass additional data to your shaders. To add a custom uniform, first open the Custom Uniforms popover using the button at the status bar (bottom of the editor), then click on the "+" button. You can specify the name and type of the uniform, and it will be available for use in your shader code.` );
            docMaker.lineBreak();
            docMaker.paragraph( `Textures and Sounds can be used in your shaders by assigning them to the iChannel uniforms. You must use existing assets from the ShaderHub library. To assign texture/sounds to an iChannel, click on the corresponding channel in the status bar and select the asset you want to use.` );
        } } );

        docMaker.header( "Saving and Sharing Shaders.", "h2", "saving-and-sharing-shaders", { collapsable: true, className: collapsibleClass, collapsed: true, collapsableContentCallback: () => {
            docMaker.root.classList.add( 'py-4' );
            docMaker.paragraph( `Once you've created a shader that you're happy with, you can save it to your ShaderHub account by clicking the "Save" button in the shader options menu. If your shader is public, it will be visible to everyone.
                You can also share your shaders with others by providing them with a direct link. Simply copy the URL from your browser's address bar and send it to anyone you want to share your shader with. They will be able to view, edit and run your shader in their own browser (not save it!).` );
            docMaker.lineBreak();
            docMaker.paragraph( `If you want to allow others to remix your shader, you can enable the remix option in the shader settings. This will let other users create their own versions of your shader while still giving you credit as the original author.` );
        } } );

        docMaker.header( "Source Code.", "h1", "source-code" );

        docMaker.paragraph( `ShaderHub is an open-source project, and its source code is available on GitHub. You can find the repository <a class='underline underline-offset-4' href="https://github.com/upf-gti/ShaderHub">here</a>.` );

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
            Quick help
        */

        const makeParagraph = ( text, p, extraClass ) => {
            LX.makeContainer( ["auto", "auto"], "p-2 text-card-foreground text-xs " + ( extraClass ?? "" ), text, p, { wordBreak: "break-word" } );
        }

        customTabInfoButtonsPanel.addButton( null, "OpenQuickHelp", ( name, event ) => {

            const dialog = new LX.Dialog( "Quick Help", ( p ) => {

                p.root.classList.add( "custom-parameters-panel", "help-content", "p-2", "overflow-y-scroll" );

                makeParagraph( `ShaderHub is a playground for both WebGPU render and compute shaders. Everything here is written in WGSL, which is WebGPU's native shader language. For up-to-date information on WGSL, please see the <a href='https://www.w3.org/TR/WGSL/'>WGSL draft specification</a>. You can also take a <a href='https://google.github.io/tour-of-wgsl/'>tour of WGSL</a>.`, p );

                p.addTitle( "Inputs" );
                makeParagraph( `ShaderHub allows to use custom values controlled by sliders and provides the following default inputs:`, p );
                makeParagraph( `Mouse input can be accessed from the <span class="text-destructive font-semibold">iMouse</span> struct:`, p );
                makeParagraph( `<span class="text-foreground">iMouse.pos: vec2f</span> <span class="text-muted-foreground">// Mouse move position when pressed</span><br>
<span class="text-foreground">iMouse.start: vec2f</span> <span class="text-muted-foreground">// Mouse down position</span><br>
<span class="text-foreground">iMouse.delta: vec2f</span> <span class="text-muted-foreground">// Delta since last mouse move position</span><br>
<span class="text-foreground">iMouse.press: f32</span> <span class="text-muted-foreground">// Mouse button down (none = -1, left = 0, middle: 1, right = 2)</span><br>
<span class="text-foreground">iMouse.click: f32</span> <span class="text-muted-foreground">// Mouse button clicked (none = -1, left = 0, middle: 1, right = 2)</span>`, p );

                makeParagraph( `Screen information:`, p );
                makeParagraph( `<span class="text-foreground">iResolution: vec2f</span> <span class="text-muted-foreground">// Viewport resolution</span><br>`, p );

                makeParagraph( `Time information:`, p );
                makeParagraph( `<span class="text-foreground">iTime: f32</span> <span class="text-muted-foreground">// Elapsed time</span><br>
<span class="text-foreground">iTimeDelta: f32</span> <span class="text-muted-foreground">// Delta time between frames</span><br>
<span class="text-foreground">iFrame: i32</span> <span class="text-muted-foreground">// Frame number</span>`, p );

                makeParagraph( `Selectable channel textures (with support for different texture samplers):`, p );
                makeParagraph( `<span class="text-foreground">iChannel0...3: texture_2d<f32></span><br>
<span class="text-muted-foreground">// where sampler can be "nearestSampler", "bilinearSampler", "trilinearSampler",</span><br>
<span class="text-muted-foreground">// "nearestRepeatSampler", "bilinearRepeatSampler" or "trilinearRepeatSampler"</span><br>
<span class="text-foreground">textureSample(iChannel0...3, <span class="text-destructive font-semibold">sampler</span>, uv)</span>`, p );

                p.addTitle( "Preprocessor" );

                makeParagraph( `ShaderHub also provides an experimental WGSL preprocessor. It currently allows the use of some directives:`, p );
                makeParagraph( `<ul style="margin-block:0">
    <li><span class="text-destructive font-semibold">#define NAME VALUE</span> for simple macros (function-like substitution not supported)</li>
    <li><span class="text-destructive font-semibold">#if #elseif #else #endif</span> for conditional compilation</li>
    <li><span class="text-destructive font-semibold">SCREEN_WIDTH</span> and <span class="text-destructive font-semibold">SCREEN_HEIGHT</span> are predefined variables for accessing canvas dimensions</li>
</ul>`, p );

                makeParagraph( `For <span class="text-destructive font-semibold">compute</span> shaders:`, p );
                makeParagraph( `<ul style="margin-block:0">
    <li><span class="text-destructive font-semibold">#workgroup_count ENTRYPOINT X Y Z</span> for specifying how many workgroups should be dispatched for an entrypoint</li>
    <li><span class="text-destructive font-semibold">#dispatch_once ENTRYPOINT</span> for initialization purposes, ensuring the entrypoint is dispatched only once</li>
    <li><span class="text-destructive font-semibold">#storage NAME TYPE</span> for declaring a storage buffer</li>
</ul>`, p );

                p.addTitle( "Examples" );
                makeParagraph( `<a href="/?shader=68b8931090e336e8a1ad" class="text-foreground decoration-none font-semibold hover:text-card-foreground underline-offset-4 hover:underline cursor-pointer">Custom Uniforms</a>`, p);
                makeParagraph( `<a href="/?shader=68c449875d3a5535bba0" class="text-foreground decoration-none font-semibold hover:text-card-foreground underline-offset-4 hover:underline cursor-pointer">Texture Buffer pass</a>`, p);
                makeParagraph( `<a href="/?shader=68dac43a64cff0f5fa9d" class="text-foreground decoration-none font-semibold hover:text-card-foreground underline-offset-4 hover:underline cursor-pointer">Simple Compute Pass</a>`, p);
                makeParagraph( `<a href="/?shader=68da7c00ef76c57eb056" class="text-foreground decoration-none font-semibold hover:text-card-foreground underline-offset-4 hover:underline cursor-pointer">Compute Storage usage</a>`, p);

                const pass = ShaderHub.currentPass;
                if( pass )
                {
                    p.addTitle( "Shader Code" );
                    makeParagraph( `Here are the current contents of this shader:`, p );

                    const code = pass.codeContent ?? "";
                    const lines = code.replaceAll( "    ", "&emsp;" ).split( "\n" ).map( l => `<span>${ l }</span>` )
                    makeParagraph( lines.join( "" ), p, "flex flex-col p-4 text-muted-foreground" );
                }

            }, { modal: false, size: [ "700px", "min(calc(100% - 32px), 900px)" ] } );

        }, { icon: "CircleQuestionMark", title: "Quick Help", tooltip: true, buttonClass: "ghost" } );

        /*
            Custom Uniforms info
        */

        const customParametersContainer = LX.makeContainer(
            [`${ Math.min( 800, window.innerWidth - 64 ) }px`, "auto"],
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
                        }, { className: "primary", width: "35%", skipReset: true, min: u.min, max: u.max, step } );
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
                            { name: "Delete", icon: "Trash2", className: "destructive", callback: () => {
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
        }, { icon: "Settings2", title: "Custom Parameters", tooltip: true, buttonClass: "ghost" } );

        /*
            Compile Button
        */

        customTabInfoButtonsPanel.addButton( null, "CompileShaderButton", async () => {
            await ShaderHub.compileShader( true, null, true );
        }, { icon: "Play", title: "Compile", tooltip: true, buttonClass: "ghost" } );

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

        canvas.addEventListener( 'keydown', async e => {
            ShaderHub.onKeyDown( e );
            e.preventDefault();
        }, false);

        canvas.addEventListener( 'keyup', async e => {
            ShaderHub.onKeyUp( e );
            e.preventDefault();
        }, false);

        canvas.addEventListener( 'mousedown', e => {
            ShaderHub.onMouseDown( e.offsetX, e.offsetY, e.button );
        });

        canvas.addEventListener( 'mouseup', e => {
            ShaderHub.onMouseUp( e );
        });

        canvas.addEventListener( 'mousemove', e => {
            ShaderHub.onMouseMove( e.offsetX, e.offsetY );
        });

        // Touch events

        canvas.addEventListener( 'touchstart', e => {
            e.preventDefault();
            const t = e.touches[ 0 ];
            const rect = canvas.getBoundingClientRect();
            ShaderHub.onMouseDown( t.clientX - rect.x, t.clientY - rect.y, 1 /* simulate left button */ );
        }, { passive: false });

        canvas.addEventListener( 'touchend', e => {
            e.preventDefault();
            const t = e.changedTouches[ 0 ];
            if( t ) ShaderHub.onMouseUp( e );
        }, { passive: false });

        canvas.addEventListener( 'touchmove', e => {
            e.preventDefault(); // Prevent scrolling while dragging
            const t = e.touches[ 0 ];
            const rect = canvas.getBoundingClientRect();
            ShaderHub.onMouseMove( t.clientX - rect.x, t.clientY - rect.y );
        }, { passive: false } );

        return canvas;
    },

    async onLogin( user )
    {
        // Update login info
        const loginButton = document.querySelector( "#loginOptionsButton button" );
        if( loginButton )
        {
            loginButton.innerHTML = await this.getLoginHtml( user );
        }

        // Hide signup info
        document.querySelector( "#signupContainer" )?.classList.add( "hidden" );

        // Login feedback
        document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
        Utils.toast( `✅ Logged in`, `Welcome ${ user.email }!` );

        const params = new URLSearchParams( document.location.search );
        const queryShader = params.get( "shader" );
        if( queryShader )
        {
            await this._createShaderDataView();
        }
        else if( document.location.hash === "" )
        {
            ShaderHub.openPage( "browse" );
        }
    },

    async onLogout()
    {
        await this.fs.logout();

        // Remove welcome message if any
        LX.deleteElement( document.querySelector( "#welcomeMessage" ) );

        // Update login info
        const loginButton = document.querySelector( "#loginOptionsButton button" );
        if( loginButton )
        {
            loginButton.innerHTML = await this.getLoginHtml();
        }

        // Show again signup info
        document.querySelector( "#signupContainer" )?.classList.remove( "hidden" );

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
        iButton.classList.remove( "bg-destructive",  "hover:bg-destructive" );
        iButton.classList.add( "bg-none", "lexbutton" );

        this.allowCapture = true;
    },

    openRecoverPasswordDialog()
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const dialog = new LX.Dialog( "Recover Password", ( p ) => {
            const formData = {
                email: { label: "Email", value: "", icon: "AtSign" },
            };
            const form = p.addForm( null, formData, async (value, errors, event) => {
                
                try {
                    const r = await this.fs.account.createRecovery({
                        email: value.email,
                        url: window.location.href // Redirect URL after recovery
                    });

                    if( r )
                    {
                        dialog.close();
                        Utils.toast( `✅ Recovery email sent`, `Please check your email (${ value.email }) for further instructions.` );
                    }
                } catch( e ) {
                    errorMsg.set( `❌ ${ e }` );
                }

            }, { primaryActionName: "Continue", secondaryButtonClass: "ghost", secondaryActionName: "Cancel", secondaryActionCallback: () => {
                dialog.close();
            } });
            const errorMsg = p.addTextArea( null, "", null, { inputClass: "text-card-foreground", disabled: true, fitHeight: true } );
        }, { modal: true } );

        this._lastOpenedDialog = dialog;
    },

    openUpdatePasswordRecoverDialog( userId, secret )
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const dialog = new LX.Dialog( "Update Password", ( p ) => {
            const formData = {
                password: { label: "New password", value: "", type: "password", icon: "Key", pattern: { minLength: Constants.PASSWORD_MIN_LENGTH, digit: true } },
                confirmPassword: { label: "Confirm new password", value: "", type: "password", icon: "Key", pattern: { fieldMatchName: "password" } }
            };
            const form = p.addForm( null, formData, async (value, errors, event) => {
                
                const r = await this.fs.account.updateRecovery({
                    userId,
                    secret,
                    password: value.password
                });

                // console.log(r);
                dialog.close();
                Utils.toast( `✅ Password updated`, `You can now login with your new password.` );

            }, { primaryActionName: "Continue", secondaryButtonClass: "ghost", secondaryActionName: "Cancel", secondaryActionCallback: () => {
                dialog.close();
            } });
        }, { modal: true } );

        this._lastOpenedDialog = dialog;
    },

    openLoginDialog()
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const dialog = new LX.Dialog( "Login", ( p ) => {
            const formData = {
                email: { label: "Email", value: "", icon: "AtSign" },
                password: { label: "Password", icon: "Key", value: "", type: "password" }
            };
            const form = p.addForm( null, formData, async (value, errors, event) => {
                form.syncInputs(); // Force sync
                await this.fs.login( value.email, value.password, async ( user, session ) => {
                    dialog.close();
                    await this.onLogin( user );
                }, (err) => {
                    Utils.toast( `❌ Error`, err, -1 );
                } );
            }, { primaryActionName: "Login", secondaryButtonClass: "ghost", secondaryActionName: "Cancel", secondaryActionCallback: () => {
                dialog.close();
            } });
            p.addSeparator();
            p.addButton( null, "Forgot my password", async () => {
                this.openRecoverPasswordDialog();
            }, { buttonClass: "link" } );
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

            const formData = {
                userName: { label: "Username", value: "", icon: "User", pattern: { minLength: Constants.USERNAME_MIN_LENGTH } },
                name: { label: "Display Name (optional)", value: "" },
                email: { label: "Email", value: "", icon: "AtSign", pattern: { email: true } },
                password: { label: "Password", value: "", type: "password", icon: "Key", pattern: { minLength: Constants.PASSWORD_MIN_LENGTH, digit: true } },
                confirmPassword: { label: "Confirm password", value: "", type: "password", icon: "Key", pattern: { fieldMatchName: "password" } }
            };

            const form = p.addForm( null, formData, async (value, errors, event) => {

                if( errors.length > 0 )
                {
                    errorMsg.set( errors.map( e => `${ e.entry }: ${ e.messages.join( "\n" ) }` ).join( "\n\n" ) );
                    return;
                }

                Utils.toast( `✅ Account created!`, `You can now login with your email: ${ value.email }` );

                await this.fs.createAccount( value.email, value.password, value.userName, async ( user ) => {
                    dialog.close();
                    document.querySelectorAll( ".lextoast" ).forEach( t => t.close() );
                    Utils.toast( `✅ Account created!`, `You can now login with your email: ${ value.email }` );

                    // Update DB
                    {
                        const result = await this.fs.createDocument( FS.USERS_COLLECTION_ID, {
                            "user_id": user[ "$id" ],
                            "user_name": value.userName,
                            "display_name": value.name.length ? value.name : undefined,
                        } );
                    }

                    this.openLoginDialog();

                }, (err) => {
                    errorMsg.set( `❌ ${ err }` );
                } );
            }, { primaryActionName: "SignUp", secondaryButtonClass: "ghost", secondaryActionName: "Cancel", secondaryActionCallback: () => {
                dialog.close();
            } });
            const errorMsg = p.addTextArea( null, "", null, { inputClass: "text-card-foreground", disabled: true, fitHeight: true } );
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
            }, { className: "primary" } );

            p.addCheckbox( "Allow Remix", r.remixable ?? true, ( v ) => {
                shaderDirty = true;
                r.remixable = v;
            }, { className: "primary" } );

            p.addSeparator();

            p.sameLine( 2 );
            p.addButton( null, "Discard Changes", () => dialog.close(), { width: "50%", buttonClass: "destructive" } );
            p.addButton( null, "Save Shader", async () => {
                if( !shaderDirty ) return;
                await this.fs.updateDocument( FS.SHADERS_COLLECTION_ID, r[ "$id" ], {
                    "public": r.public ?? true,
                    "remixable": r.remixable ?? true
                } );
                Utils.toast( `✅ Shader updated`, `Shader: ${ r.name } by ${ this.fs.user.name }` );
                shaderDirty = false;
                dialog.close();
            }, { width: "50%", buttonClass: "primary" } );

        }, { modal: false } );

        this._lastOpenedDialog = dialog;
    },

    async openCurrentShaderLikesDialog( shader )
    {
        if( this._lastOpenedDialog )
        {
            this._lastOpenedDialog.close();
        }

        const shaderLikes = await this.fs.listDocuments( FS.INTERACTIONS_COLLECTION_ID, [
            Query.equal( "type", "like" ),
            Query.equal( "shader_id", shader.uid ),
            Query.limit( 300 ),
            Query.orderDesc( "$createdAt" )
        ] );

        if( shaderLikes.total === 0 )
        {
            const dialog = new LX.Dialog( null, ( p ) => {

                // As the AlertDialog
                p.root.className = LX.mergeClass( p.root.className, 'pad-2xl flex flex-col gap-2' );
                LX.makeContainer( [ '100%', '100%' ], 'text-lg font-medium text-foreground p-2', `This shader doesn't have likes yet.`, p );

                p.addTextArea( null, `Share this shader so other people can check it and leave a like!`, null, { disabled: true, fitHeight: true, inputClass: 'bg-none text-sm text-muted-foreground' } );
                p.addSeparator();
                p.addButton( null, 'Close', () => {
                    dialog.destroy();
                }, { buttonClass: 'h-8 ghost' } );

            }, { modal: true } );

            this._lastOpenedDialog = dialog;
            return;
        }

        const authorIds = Array.from( new Set( shaderLikes.documents.map( c => c["author_id"] ) ) );
        const usersWithLikes = await this.fs.listDocuments( FS.USERS_COLLECTION_ID, [ Query.equal( "user_id", authorIds ) ] );

        const dialog = new LX.Dialog( `${shaderLikes.total} like${shaderLikes.total > 1 ? "s" : ""}`, ( p ) => {

            const container = LX.makeContainer( ["100%", "auto"], "flex flex-col p-2 gap-2 max-h-64 overflow-scroll", "", p );

            for( const like of shaderLikes.documents )
            {
                const authorId = like[ "author_id" ];
                const dbUser = usersWithLikes.documents.find( u => u["user_id"] === authorId );
                const commentAuthorName = dbUser.user_name;
                const avatar = new LX.Avatar({
                    imgSource: dbUser.avatar,
                    fallback: commentAuthorName[ 0 ].toUpperCase(),
                    className: 'mx-2 flex-auto-keep'
                });

                const cont = LX.makeContainer( ["100%", "auto"], "flex flex-row items-center gap-1", `
                    ${ avatar.root.outerHTML }
                    <span>${ dbUser.user_name }</span>
                `, container );
            }

            p.addSeparator();
            p.addButton( null, "Close", () => dialog.close(), { buttonClass: "h-8 ghost" } );

        }, { modal: true } );

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
                p.addTextArea( null, `Direct link - Just copy and past the URL below:`, null, { inputClass: "text-card-foreground", disabled: true, fitHeight: true } );
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
                LX.addClass( copyButtonComponent.root.querySelector( ".swap-on svg" ), "text-success" );
            }

            p.addSeparator();

            // iframe code
            {
                p.addTextArea( null, `iFrame - Copy the code below to embed this shader in your website or blog:`, null, { inputClass: "text-card-foreground", disabled: true, fitHeight: true } );
                p.addCheckbox( "Show UI", showUI, ( v ) => {
                    showUI = v;
                    const newUrl = `<iframe src="${ window.location.origin }${ window.location.pathname }embed/?shader=${ r[ "$id" ] }${ showUI ? "" : "&ui=false" }" frameborder="0" width="640" height="405" class="rounded-lg" allowfullscreen></iframe>`;
                    iframeText.set( newUrl );
                }, { className: "primary" } );

                const iframeUrl = `<iframe src="${ window.location.origin }${ window.location.pathname }embed/?shader=${ r[ "$id" ] }${ showUI ? "" : "&ui=false" }" frameborder="0" width="640" height="405" class="rounded-lg" allowfullscreen></iframe>`;

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
                LX.addClass( copyButtonComponent.root.querySelector( ".swap-on svg" ), "text-success" );
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
            modal: false, draggable: true, size: [ Math.min( 800, window.innerWidth - 64 ), "auto" ]
        } );

        // Put all the stuff in the dialog panel
        this.customParametersPanel.refresh( dialog.panel );

        const uniformsHeader = LX.makeContainer( ["auto", "auto"], "flex flex-row items-center", "", dialog.title );
        const addUniformButton = new LX.Button( null, "AddNewCustomUniform", () => {
            ShaderHub.addUniform();
            this.customParametersPanel.refresh( dialog.panel, () => dialog.title.childNodes[ 0 ].textContent = `Uniforms [${ pass.uniforms.length }]` );
        }, { icon: "Plus", className: "ml-auto self-center", buttonClass: "bg-none", title: "Add New Uniform", width: "38px" } );
        uniformsHeader.appendChild( addUniformButton.root );
        LX.makeContainer( [`auto`, "0.75rem"], "ml-2 mr-4 border-right border-colored text-muted-foreground self-center items-center", "", uniformsHeader );
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

        if( !this._dbAssets )
        {
            this._dbAssets = await this.fs.listDocuments( FS.ASSETS_COLLECTION_ID, [
                // Query.equal( "category", category )
            ] );
        }

        if( this._dbAssets.total === 0 )
        {
            LX.makeContainer( ["100%", "auto"], "mt-8 text-2xl font-medium justify-center text-center", "No data found.", container );
            return;
        }

        const _createChannelItems = async ( category, container ) => {

            const assets = this._dbAssets.documents.filter( a => a.category === category );
            const usedMiscChannels = [ "Keyboard", ...( ShaderHub.shader?.passes.map( p => p.name ) ?? [] ) ];

            for( const document of assets )
            {
                if( category === "misc" && !usedMiscChannels.includes( document.name ) )
                {
                    continue;
                }

                const channelItem = LX.makeElement( "li", "relative flex rounded-lg bg-card box-border hover:bg-accent overflow-hidden", "", container );
                channelItem.style.maxHeight = "200px";
                const channelPreview = LX.makeElement( "img", "w-full h-full rounded-t-lg bg-card hover:scale-105 transition-transform ease-out border-none cursor-pointer", "", channelItem );
                const fileId = document[ "file_id" ];
                const localUrl = document[ "local_url" ];
                const preview = document[ "preview" ];
                channelPreview.src = localUrl ?? ( preview ? await this.fs.getFileUrl( preview ) : ( fileId ? await this.fs.getFileUrl( fileId ) : "images/shader_preview.png" ) );
                const shaderDesc = LX.makeContainer( ["100%", "auto"], "absolute text-xs top-0 p-2 w-full rounded-t-lg bg-background-blur backdrop-blur-xs items-center select-none font-semibold keep-all", `
                    ${ document.name } (uint8)
                `, channelItem );
                channelItem.addEventListener( "click", async ( e ) => {
                    e.preventDefault();
                    ShaderHub.addUniformChannel( pass, this._currentChannelIndex, { id: fileId ?? document.name, category } )
                    await this.updateShaderChannelsView( pass, this._currentChannelIndex );
                    dialog.close();
                } );
            }
        }

        const area = new LX.Area( { skipAppend: true } );
        const tabs = area.addTabs( { parentClass: "bg-card p-4", sizes: [ "auto", "auto" ], contentClass: "bg-card p-4 pt-0" } );

        {
            if( !this.texturesContainer )
            {
                this.texturesContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-3 p-2 rounded-lg justify-center overflow-scroll" );
            }

            this.texturesContainer.innerHTML = "";
            await _createChannelItems( "texture", this.texturesContainer );
            this.texturesContainer.style.display = "grid";
            tabs.add( "Textures", this.texturesContainer, { selected: true } );
        }

        {
            if( !this.miscContainer )
            {
                this.miscContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-3 p-2 rounded-lg justify-center overflow-scroll" );
            }

            this.miscContainer.innerHTML = "";
            await _createChannelItems( "misc", this.miscContainer );
            this.miscContainer.style.display = "grid";
            tabs.add( "Misc", this.miscContainer );
        }

        {
            if( !this.cubemapsContainer )
            {
                this.cubemapsContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-3 p-2 rounded-lg justify-center overflow-scroll" );
            }

            this.cubemapsContainer.innerHTML = "";
            await _createChannelItems( "cubemap", this.cubemapsContainer );
            this.cubemapsContainer.style.display = "grid";
            tabs.add( "Cubemaps", this.cubemapsContainer );
        }

        {
            if( !this.soundsContainer )
            {
                this.soundsContainer = LX.makeContainer( [ "100%", "100%" ], "grid channel-server-list gap-3 p-2 rounded-lg justify-center overflow-scroll" );
            }

            this.soundsContainer.innerHTML = "";
            await _createChannelItems( "sound", this.soundsContainer );
            this.soundsContainer.style.display = "grid";
            tabs.add( "Sound", this.soundsContainer );
        }

        this._currentChannelIndex = channelIndex;

        let dialog = new LX.Dialog( `[${ pass.name }] Channel${ channelIndex }`, (p) => {
            p.root.classList.remove( "break-all" );
            p.attach( area );
        }, { modal: false, close: true, minimize: false, size: [`${ Math.min( 1280, window.innerWidth - 64 ) }px`, "530px"], draggable: true });

        this._lastOpenedDialog = dialog;
    },

    async updateShaderChannelsView( pass, channel )
    {
        pass = pass ?? ShaderHub.currentPass;

        this.toggleShaderChannelsView( pass.type === "common" );

        const iUpdateChannel = async ( channelIndex ) => {

            const channel = pass.channels[ channelIndex ];
            const child = this.channelsContainer.children[ channelIndex ];
            if( child ) this.channelsContainer.removeChild( child );

            const channelContainer = LX.makeContainer( ["100%", "100%"], "relative text-center content-center box-shadow box-border rounded-lg bg-card hover:bg-accent cursor-pointer overflow-hidden", "" );
            channelContainer.style.minHeight = "100px";
            LX.insertChildAtIndex( this.channelsContainer, channelContainer, channelIndex );

            const channelImage = LX.makeElement( "img", "size-full rounded-lg bg-card hover:bg-accent hover:scale-105 transition-transform ease-out border-none", "", channelContainer );
            const metadata = await ShaderHub.getChannelMetadata( pass, channelIndex );
            let imageSrc = Constants.IMAGE_EMPTY_SRC;
            if( metadata?.url )
            {
                if( !this.imageCache[ metadata.url ] )
                {
                    this.imageCache[ metadata.url ] = await Utils.imageToDataURL( this.fs, metadata.url )
                }

                imageSrc = this.imageCache[ metadata.url ];
            }
            channelImage.src = imageSrc;

            // Channel Title
            LX.makeContainer( ["100%", "auto"], "p-2 absolute bg-background-blur backdrop-blur-xs text-xs text-center content-center top-0 rounded-t-lg pointer-events-none",
                metadata?.name ? `<span class="font-semibold">${ metadata.name }</span> (iChannel${ channelIndex })` : `iChannel${ channelIndex }`, channelContainer );

            if( !!channel )
            {
                // Channel Options
                const channelOptions = LX.makeContainer( ["100%", "auto"], "flex flex-row absolute bg-background-blur backdrop-blur-xs text-xs text-center content-center justify-end bottom-0 rounded-b-lg", "", channelContainer );
                const panel = new LX.Panel({ className: "w-fit m-0 p-0" });
                channelOptions.appendChild( panel.root );
                panel.sameLine();

                if( channel.category === "sound" )
                {
                    panel.addButton( null, "PlayButton", ( name, e ) => ShaderHub.playSoundUniformChannel( channelIndex ),
                        { icon: "Pause", swap: "Play", title: "Play/Pause Channel", tooltip: true, className: "p-0", buttonClass: "sm ghost" } );

                    panel.addButton( null, "RewindButton", ( name, e ) => ShaderHub.rewindSoundUniformChannel( channelIndex ),
                        { icon: "Rewind", title: "Rewind Channel", tooltip: true, className: "p-0", buttonClass: "sm ghost" } );

                    panel.addButton( null, "MuteButton", ( name, e ) => ShaderHub.muteSoundUniformChannel( channelIndex ),
                        { icon: "Volume2", swap: "VolumeOff", title: "Mute Channel", tooltip: true, className: "p-0", buttonClass: "sm ghost" } );
                }

                panel.addButton( null, "ChannelOptionsButton", async ( name, e ) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // const svgClass = "2xs fill-current inline-flex! mr-2";
                    LX.addDropdownMenu( e.target, [
                        // { name: "Filter", submenu: [
                        //     { name: `${ channel.filter === "linear" ? LX.makeIcon( "Circle", { svgClass } ).innerHTML : "" }Linear`, callback: async () => ShaderHub.updateUniformChannelFilter( pass, channelIndex, "linear" ) },
                        //     { name: `${ channel.filter === "mipmap" ? LX.makeIcon( "Circle", { svgClass } ).innerHTML : "" }Mipmap`, callback: async () => ShaderHub.updateUniformChannelFilter( pass, channelIndex, "mipmap" ) },
                        //     { name: `${ channel.filter === "nearest" ? LX.makeIcon( "Circle", { svgClass } ).innerHTML : "" }Nearest`, callback: async () => ShaderHub.updateUniformChannelFilter( pass, channelIndex, "nearest" ) },
                        // ] },
                        // { name: "Wrap", submenu: [
                        //     { name: `${ channel.wrap === "clamp" ? LX.makeIcon( "Circle", { svgClass } ).innerHTML : "" }Clamp to Edge`, callback: async () => ShaderHub.updateUniformChannelWrap( pass, channelIndex, "clamp" ) },
                        //     { name: `${ channel.wrap === "repeat" ? LX.makeIcon( "Circle", { svgClass } ).innerHTML : "" }Repeat`, callback: async () => ShaderHub.updateUniformChannelWrap( pass, channelIndex, "repeat" ) },
                        // ] },
                        // null,
                        { name: "Remove", className: "destructive", callback: async () => await ShaderHub.removeUniformChannel( channelIndex ) },
                    ], { side: "top", align: "end" });
                }, { icon: "Settings", title: "Channel Options", tooltip: true, className: "p-0", buttonClass: "pointer-events-auto sm ghost" } );

                panel.endLine( "justify-end" );
            }

            channelImage.addEventListener( "click", async ( e ) => {
                e.preventDefault();
                await this.openAvailableChannels( pass, channelIndex );
            } );
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
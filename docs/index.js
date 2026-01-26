import { LX } from 'lexgui';
import 'lexgui/extensions/CodeEditor.js';
import { DocMaker } from 'lexgui/extensions/DocMaker.js';
import * as Utils from './../src/utils.js';

const area = await LX.init({ rootClass: "wrapper" });
const mobile = Utils.isMobile();
const imagesRootPath = '/images/';

LX.setThemeColor('orange');

const starterMode = LX.getMode();
const content = document.querySelector('.lexdocs-content');
const menubarButtons = [
    {
        title: "Change Theme",
        icon: starterMode == "dark" ? "Moon" : "Sun",
        swap: starterMode == "dark" ? "Sun" : "Moon",
        callback: (value, event) => { LX.switchMode() }
    }
];
const sidebarOptions = {
    headerTitle: `ShaderHub`,
    headerSubtitle: `Docs`,
    headerImage: "../images/favicon.png",
    skipFooter: true,
    // footerTitle: "jxarco",
    // footerSubtitle: "alexroco.30@gmail.com",
    // footerImage: "https://avatars.githubusercontent.com/u/25059187?v=4",
    onFooterPressed: (event, dom) => {
        event.preventDefault();
        LX.addDropdownMenu(dom, [
            "Other Projects",
            null,
            { disabled: true, name: "wgpuEngine", icon: "Torus", callback: () => open("https://github.com/upf-gti/wgpuEngine", "_blank") },
            { name: "Rooms VR", icon: "DoorOpen", callback: () => open("https://github.com/upf-gti/rooms", "_blank") },
            null,
            "Socials",
            null,
            { name: "Github", icon: "Github", callback: () => open("https://github.com/jxarco", "_blank") },
            { name: "Linkedin", icon: "Linkedin", callback: () => open("https://www.linkedin.com/in/alejandro-roco/", "_blank") },
        ], { side: "right", align: "start" });
    },
    collapsed: false,
    collapsable: false,
    displaySelected: true
};

globalThis.docMaker = new DocMaker();
const oldScripts = [];
let path = null, menubar = null, sheetArea = null;;

docMaker.setDomTarget(content);

window.setPath = function (startPage) {

    const tokens = startPage.split('/');
    const startPath = [];

    for (let t of tokens) {
        startPath.push( LX.toTitleCase(t) );
    }

    if (startPath.length) {
        path = startPath;
    }

    return startPath.pop();
}

window.loadPage = function (page, addToHistory = true, title, callback) {
    fetch(page)
        .then(response => response.text())
        .then(html => {

            content.parentElement.scrollTop = 0;

            oldScripts.forEach(script => script.remove());

            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = html;

            const scripts = tempDiv.querySelectorAll("script");
            scripts.forEach(script => script.remove());
            content.innerHTML = tempDiv.innerHTML;

            scripts.forEach(script => {
                const newScript = document.createElement("script");
                newScript.type = script.type;
                if (script.src) {
                    newScript.src = script.src; // external scripts
                    newScript.onload = () => console.log(`Loaded: ${script.src}`);
                } else {
                    newScript.textContent = script.textContent; // inline scripts
                }
                document.body.prepend(newScript);
                oldScripts.push(newScript);
            });

            if (addToHistory) {
                history.pushState({ page }, "", `?p=${page.substring(page.lastIndexOf('/')+1).replace(".html", "")}`);
            }

            if (title) document.title = `${title} - ShaderHub Docs`;
        })
        .then(callback)
        .catch((err) => {
            console.error(err);
            content.innerHTML = "<p>Error loading content.</p>";
        });
}

window.addEventListener("popstate", function (event) {
    if (event.state?.page) {
        loadPage(event.state.page, false);
    }
});

const open = (url, target, name, dom, event) => {
    if (event) event.preventDefault();

    const anchor = target && (target[0] == '#');
    const breadcrumb = target && (target.constructor === Array);

    if (target && !anchor && !breadcrumb) {
        window.open(url, target);
    }
    else {
        path = null;

        loadPage(url, true, name, () => {
            if (anchor) {
                LX.doAsync(() => document.getElementById(target.substring(1))?.scrollIntoView({ behavior: 'smooth' }), 20);
            }
        });
    }

    if (window.__currentSheet) {
        window.__currentSheet.destroy();
    }
}

const sidebarCallback = m => {

    const entryCallback = v => open(`manual/${v.toLowerCase().replaceAll(" ", "-")}.html`, [], v);
    const entryOptions = { callback: entryCallback };

    m.group( "Create");
    m.add( "Getting Started", entryOptions );
    m.add( "Shader Passes", entryOptions );
    m.add( "Shader Passes/Image Pass", entryOptions );
    m.add( "Shader Passes/Compute Pass", entryOptions );
    m.add( "Preprocessor", entryOptions );
    m.add( "Channels", entryOptions );
    m.add( "Channels/Image Channel", entryOptions );
    m.add( "Channels/Keyboard Channel", entryOptions );
    m.add( "Channels/Sound Channel", entryOptions );
    m.add( "Default Uniforms", entryOptions );
    m.add( "Custom Uniforms", entryOptions );
    m.add( "Share & Export", entryOptions );
    m.separator();
    m.group("Explore");
    m.add( "Search Shaders", entryOptions );
    m.add( "Remix", entryOptions );
    m.separator();
    m.add( "About", entryOptions );
    m.add( "Source Code", { icon: "Code", skipSelection: true, callback: open.bind(this, "https://github.com/jxarco/ShaderHub/", "_blank") } );
    // m.add("General", { skipSelection: true });
}

if (mobile) {
    menubar = area.addMenubar([], { parentClass: "bg-none" });

    sheetArea = new LX.Area({ skipAppend: true });
    sheetArea.addSidebar(sidebarCallback, sidebarOptions);
}
else {
    const sidebar = area.addSidebar(sidebarCallback, sidebarOptions);
    menubar = sidebar.siblingArea.addMenubar([], { parentClass: "bg-none" });
}

menubar.addButtons(menubarButtons, { float: mobile ? "right" : "center" });


menubar.root.classList.add("hub-background-blur-md");
LX.addClass( menubar.siblingArea.root, "content-area");
menubar.siblingArea.root.style.overflowY = "scroll";
menubar.siblingArea.root.appendChild(content);

if (mobile) {
    menubar.root.querySelector(".lexmenubuttons").style.marginLeft = "auto";

    const menuButton = new LX.Button(null, "MenuButton", () => {
        window.__currentSheet = new LX.Sheet("256px", [sheetArea]);
    }, { icon: "Menu", buttonClass: "p-4 bg-none" });
    menubar.root.prepend(menuButton.root);
}

const params = new URLSearchParams(document.location.search);
const queryPage = params.get("p");
const startPage =  `manual/${queryPage ?? "getting-started"}`;
const tabName = window.setPath(startPage);

loadPage(`${startPage}.html`, !!queryPage, tabName);
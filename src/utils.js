function isMobile()
{
    return ( navigator.userAgent.match( /Android/i ) ||
        navigator.userAgent.match( /webOS/i ) ||
        navigator.userAgent.match( /iPhone/i ) ||
        navigator.userAgent.match( /iPad/i ) ||
        navigator.userAgent.match( /iPod/i ) ||
        navigator.userAgent.match( /BlackBerry/i ) ||
        navigator.userAgent.match( /Windows Phone/i ) );
}

function capitalizeFirstLetter( val )
{
    return String( val ).charAt( 0 ).toUpperCase() + String( val ).slice( 1 );
}

function toESDate( date )
{
    const ts = date.substring( 0, 10 ).split("-");
    return [ ts[ 2 ], ts[ 1 ], ts[ 0 ] ].join("-");
}

async function imageToDataURL( fs, url )
{
    const r = await fs.requestFile( url );
    const blob = new Blob( [ r ], { type: "image/png" } );
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL( blob )
    });
}

function getDate()
{
    const date = new Date();
    const day = `${ date.getDate() }`;
    const month = `${ date.getMonth() + 1 }`;
    const year = `${ date.getFullYear() }`;
    return `${ "0".repeat( 2 - day.length ) }${ day }-${ "0".repeat( 2 - month.length ) }${ month }-${ year }`;
}

const formatMD = ( text ) =>
{
    return text.substring( 0, 512 ) // CAP TO 512 chars
        .replace( /&/g, "&amp;" ).replace( /</g, "&lt;" ).replace( />/g, "&gt;" )
        .replace( /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" class="text-orange-500 underline underline-offset-4" rel="noopener noreferrer">$1</a>' ) // Links: [text](url)
        .replace( /\*\*(.*?)\*\*/g, "<b>$1</b>" ) // Bold: **text**
        .replace( /(^|[^*])\*(?!\*)([^*]+)\*(?!\*)/g, '$1<i>$2</i>' ) // Italic: *text*
        .replace( /~~(.*?)~~/g, "<u>$1</u>" ) // Underline: ~~text~~
        .replace( /\n/g, "<br>" ) // Line breaks: \n
        .trim();
};

const unformatMD = ( html ) =>
{
    return html.replace( /&lt;/g, "<" ).replace( /&gt;/g, ">" ).replace( /&amp;/g, "&" ) // Decode HTML chars
        .replace( /<br\s*\/?>/gi, "\n" )  // Line breaks
        .replace( /<a\s+[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, "[$2]($1)" ) // Links
        .replace( /<b>(.*?)<\/b>/gi, "**$1**" ) // Bold
        .replace( /<i>(.*?)<\/i>/gi, "*$1*" ) // Italic
        .replace( /<u>(.*?)<\/u>/gi, "~~$1~~" ) // Underline
        .trim();
};

const CODE2ASCII = {};

for( let i = 0; i < 26;  i++ )   CODE2ASCII["Key" + String.fromCharCode(65 + i)] = 65 + i;  // Letters A–Z → ASCII uppercase
for( let i = 0; i < 10;  i++ )   CODE2ASCII["Digit" + i] = 48 + i;                          // Digits 0–9 → ASCII '0'–'9'
for( let i = 0; i < 10;  i++ )   CODE2ASCII["Numpad" + i] = 48 + i;                         // Numpad digits. same as ASCII '0'–'9'
for( let i = 1; i <= 12; i++ )   CODE2ASCII["F" + i] = 111 + i;                            // Function keys → assign numbers starting from 112 (legacy F1..F12 codes)

// Common symbols (matching US layout ASCII)
Object.assign(CODE2ASCII, { "Space": 32, "Enter": 13, "Tab": 9, "Backspace": 8, "Escape": 27, "Minus": 45, "Equal": 61, "BracketLeft": 91, "BracketRight": 93, "Backslash": 92, "Semicolon": 59, "Quote": 39, "Backquote": 96, "Comma": 44, "Period": 46, "Slash": 47 });
// Arrows and controls (matching old keyCodes)
Object.assign(CODE2ASCII, { "ArrowLeft": 37, "ArrowUp": 38, "ArrowRight": 39, "ArrowDown": 40, "Insert": 45, "Delete": 46, "Home": 36, "End": 35, "PageUp": 33, "PageDown": 34 });

function code2ascii( c )
{
    return CODE2ASCII[ c ];
}

function toast( title, text, timeout )
{
    LX.toast( title, text, { position: "top-right", timeout } );
}

export { toast, code2ascii, getDate, toESDate, capitalizeFirstLetter, imageToDataURL, isMobile, formatMD, unformatMD };
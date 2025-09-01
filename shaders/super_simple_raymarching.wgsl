// Super simple raymarching example. Created by Reinder Nijhoff 2017
// Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License.
// @reindernijhoff
// 
// https://www.shadertoy.com/view/4dSBz3
//
// This is the shader used as example in my ray march tutorial: https://www.shadertoy.com/view/4dSfRc
//
// Created for the Shadertoy Competition 2017 
//

//
// Distance field function for the scene. It combines
// the seperate distance field functions of three spheres
// and a plane using the min-operator.
//
fn map(p : vec3f) -> f32 {
    var d : f32 = distance(p, vec3f(-1, 0, -5)) - 1.; // sphere at (-1,0,5) with radius 1
    d = min(d, distance(p, vec3f(2, 0, -3)) - 1.);    // second sphere
    d = min(d, distance(p, vec3f(-2, 0, -2)) - 1.);   // and another
    d = min(d, p.y + 1.);                            // horizontal plane at y = -1
    return d;
}

//
// Calculate the normal by taking the central differences on the distance field.
//
fn calcNormal(p : vec3f) -> vec3f {
    let e : vec2f = vec2f(1.0, -1.0) * 0.0005;
    return normalize(
        e.xyy * map(p + e.xyy) +
        e.yyx * map(p + e.yyx) +
        e.yxy * map(p + e.yxy) +
        e.xxx * map(p + e.xxx));
}

fn mainImage(fragUV : vec2f) -> vec4f {

    let ro : vec3f = vec3f(0, 0, 1);                    // ray origin

    let fragCoord : vec2f = fragUV * iResolution;
    let q : vec2f = (fragCoord.xy - .5 * iResolution.xy ) / -iResolution.y;
    let rd : vec3f = normalize(vec3f(q, 0.) - ro);             // ray direction for fragCoord.xy

    // March the distance field until a surface is hit.
    var h : f32;
    var t : f32 = 1.0;
    for (var i : i32 = 0; i < 256; i++) {
        h = map(ro + rd * t);
        t += h;
        if (h < 0.01) {
            break;
        }
    }

    if (h < 0.01) {
        let p : vec3f = ro + rd * t;
        let normal : vec3f = calcNormal(p);
        let light : vec3f = vec3f(0, 2, 0);
        
        // Calculate diffuse lighting by taking the dot product of 
        // the light direction (light-p) and the normal.
        var dif : f32 = clamp(dot(normal, normalize(light - p)), 0., 1.);
		
        // Multiply by light intensity (5) and divide by the square
        // of the distance to the light.
        dif *= 5. / dot(light - p, light - p);
        
        
        return vec4f(vec3f(pow(dif, 0.4545)), 1);     // Gamma correction
    } else {
        return vec4f(0, 0, 0, 1);
    }
}
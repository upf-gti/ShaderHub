// Title: Dynamic Metaballs – Smooth Blending Effect
// Author: Sujit Kumar
// License: MIT (c) 2025 Sujit Kumar

fn Ball( p : vec2f, center : vec2f, radius : f32 ) -> f32 {

    let dist = distance(p, center);
    
    return radius * radius / (dist * dist + 0.0001);
}

fn mainImage(fragUV : vec2f) -> vec4f {
   
    var uv : vec2f = fragUV;
    uv = uv * 2.0 - 1.0;
    //uv.x *= iResolution.x / iResolution.y;

    var sumInfluence : f32 = 0.0;

    // Moving metaball centers
    let c1 : vec2f = vec2f(sin(iTime * 1.3) * 0.6, cos(iTime * 1.7) * 0.6);
    let c2 : vec2f = vec2f(sin(iTime * 1.1) * 0.6, cos(iTime * 1.5) * 0.6);

    let radius : f32 = 0.3;

    // Combine influence fields
    sumInfluence += Ball(uv, c1, radius);
    sumInfluence += Ball(uv, c2, radius);

    // Threshold for blending
    let blob : f32 = smoothstep(1.0, 1.001, sumInfluence);

    // Colors
    var colorA = vec3f(0.2, 0.5, 0.8);
    var colorB = vec3f(0.9, 0.3, 0.5);

    // Mix colors based on influence
    var col : vec3f = mix(colorA, colorB, sumInfluence * 0.3);

    // Apply blob mask
    col *= blob;

    return vec4f(col, 1.0);
}
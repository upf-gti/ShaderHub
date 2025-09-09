fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {
    // Normalized pixel coordinates (from 0 to 1)
    let uv : vec2f = fragUV; // The same as: fragCoord/iResolution.xy;

    // Time varying pixel color
    let color : vec3f = 0.5 + 0.5 * cos(iTime + uv.xyx + vec3f(0,2,4));

    // Output to screen
    return vec4f(color, 1.0);
}
fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {
    let green : vec3f = vec3f(0.0, 1.0, 0.0);
    let amp : f32 = 0.25;
    let freq : f32 = 1.0;
    let PI : f32 = 3.141592;

    let sineY : f32 = amp * sin(fragUV.x * freq * 2.0 * PI) + 0.5;
    let topGradient : vec3f = green * (1.0 - fragUV.y);
    let bottomGradient : vec3f = green * fragUV.y;
    let mask : f32 = step(sineY, fragUV.y);

    return vec4f(mix(bottomGradient, topGradient, mask), 1.0);
}
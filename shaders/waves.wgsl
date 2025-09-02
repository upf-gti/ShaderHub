fn mainImage(fragUV : vec2f, fragCoord : vec2f) -> vec4f {

    let sineY : f32 = iAmplitude * sin(fragUV.x * iFrequency * 2.0 * PI) + 0.5;
    let topGradient : vec3f = vec3f(0.0, 1.0 - fragUV.y, 0.0);
    let bottomGradient : vec3f = vec3f(0.0, fragUV.y, 0.0);
    let mask : f32 = step(sineY, fragUV.y);

    return vec4f(mix(bottomGradient, topGradient, mask), 1.0);
}
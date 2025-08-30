fn mainImage(fragUV : vec2f) -> vec4f {
    let texUv = floor(fragUV * 128.0) / 128.0;
    let texColor: vec4f = textureSample(iChannel0, texSampler, texUv);
    return texColor * vec4f(sin(iTime) * 0.5 + 0.5);
}
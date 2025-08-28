@fragment
fn frag_main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
    let texColor: vec4f = textureSample(texture, texSampler, fragUV);
    return texColor * vec4f(0.8, 0.4, 0.2, 1.0);
}
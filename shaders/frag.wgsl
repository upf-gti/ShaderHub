@fragment
fn frag_main(@location(0) fragUV : vec2f) -> @location(0) vec4f {
  return vec4f(fragUV, 0.0, 1.0);// textureSample(myTexture, mySampler, fragUV);
}
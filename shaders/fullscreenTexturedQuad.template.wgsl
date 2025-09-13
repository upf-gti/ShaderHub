$default_bindings
$custom_bindings
$texture_bindings

struct VertexOutput {
    @builtin(position) Position : vec4f,
    @location(0) fragUV : vec2f,
    @location(1) fragCoord : vec2f,
}

@vertex
fn vert_main(@builtin(vertex_index) VertexIndex : u32) -> VertexOutput {

    const pos = array(
        vec2(-1.0, -1.0),
        vec2( 1.0, -1.0),
        vec2(-1.0,  1.0),
        vec2(-1.0,  1.0),
        vec2( 1.0, -1.0),
        vec2( 1.0,  1.0),
    );

    var output : VertexOutput;
    output.Position = vec4(pos[VertexIndex], 0.0, 1.0);
    output.fragUV = (output.Position.xy * 0.5) + vec2(0.5, 0.5);
    output.fragUV.y = 1.0 - output.fragUV.y;
    output.fragCoord = output.fragUV * iResolution;

    var time_dummy : f32 = iTime;

    return output;
}

const PI : f32 = 3.14159265359;

$common
$main_image

@fragment
fn frag_main(@location(0) fragUV : vec2f, @location(1) fragCoord : vec2f) -> @location(0) vec4f {

$default_dummies
$custom_dummies
$texture_dummies

    return mainImage(fragUV, fragCoord);
}
// Title: Dynamic Metaballs – Smooth Blending Effect
// Author: Sujit Kumar
// License: MIT (c) 2025 Sujit Kumar

fn Ball( p : vec2f, center : vec2f, radius : f32 ) -> f32 {

    let dist = distance(p, center);
    
    return radius * radius / (dist * dist + 0.0001);
}
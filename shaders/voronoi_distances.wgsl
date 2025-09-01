// The MIT License
// Copyright © 2013 Inigo Quilez
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// https://www.youtube.com/c/InigoQuilez
// https://iquilezles.org/

// Hash function
fn hash(p : vec2f) -> vec2f {
    // p = mod(p, 4.0); // optional tiling
    let q : vec2f = vec2f(
        dot(p, vec2f(127.1, 311.7)),
        dot(p, vec2f(269.5, 183.3))
    );
    return fract(sin(q) * 18.5453);
}

// Return distance and cell id
fn voronoi(x : vec2f) -> vec2f {
    let n : vec2f = floor(x);
    let f : vec2f = fract(x);

    var m : vec3f = vec3f(8.0, 0.0, 0.0);

    for (var j = -1; j <= 1; j++) {
        for (var i = -1; i <= 1; i++) {
            let g : vec2f = vec2f(f32(i), f32(j));
            let o = hash(n + g);
            let r = g - f + (0.5 + 0.5 * sin(iTime + 6.2831 * o));
            let d : f32 = dot(r, r);
            if (d < m.x) {
                m = vec3f(d, o);
            }
        }
    }

    return vec2f(sqrt(m.x), m.y + m.z);
}

fn mainImage(fragUV : vec2f) -> vec4f {

    // Compute voronoi pattern
    let c : vec2f = voronoi((14.0 + 6.0 * sin(0.2 * iTime)) * fragUV);

    // Colorize
    var col : vec3f = 0.5 + 0.5 * cos(c.y * 6.2831 + vec3f(0.0, 1.0, 2.0));
    col *= clamp(1.0 - 0.4 * c.x * c.x, 0.0, 1.0);
    col -= (1.0 - smoothstep(0.08, 0.09, c.x));

    return vec4f(col, 1.0);
}
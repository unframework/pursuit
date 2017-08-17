const onecolor = require('onecolor');
const vec2 = require('gl-matrix').vec2;
const vec3 = require('gl-matrix').vec3;
const vec4 = require('gl-matrix').vec4;
const mat4 = require('gl-matrix').mat4;
const glsl = require('glslify');

const Timer = require('./Timer');

document.title = 'Pursuit Hunter';

document.body.style.margin = '0';
document.body.style.padding = '0';
document.body.style.background = '#70787f';
document.body.style.position = 'relative';

const canvas = document.createElement('canvas');
canvas.style.position = 'absolute';
canvas.style.top = '0vh';
canvas.style.left = '0vw';
canvas.style.width = '100vw';
canvas.style.height = '100vh';
canvas.style.background = '#fff';
document.body.appendChild(canvas);

canvas.width = canvas.offsetWidth;
canvas.height = canvas.offsetHeight;
const aspectRatio = canvas.height / canvas.width;

const div = document.createElement('div');
div.style.position = 'fixed';
div.style.bottom = '10px';
div.style.right = '20px';
div.style.opacity = 0.2;
div.style.color = '#fff';
div.style.fontFamily = 'Arial';
div.style.fontSize = '24px';
div.appendChild(document.createTextNode('@line_ctrl'));
document.body.appendChild(div);

const regl = require('regl')({
    extensions: [
        'EXT_frag_depth'
    ],
    canvas: canvas
});

roadCmd = regl({
    vert: glsl`
        precision mediump float;

        uniform mat4 camera;
        uniform float drawDistance;
        attribute vec2 position;

        varying vec2 facePosition;

        void main() {
            facePosition = position;

            gl_Position = camera * vec4(
                position.x * 4.75,
                position.y * drawDistance,
                0,
                1.0
            );
        }
    `,

    frag: glsl`
        precision mediump float;

        #pragma glslify: dither = require('glsl-dither/8x8')
        #pragma glslify: cnoise2 = require('glsl-noise/classic/2d')

        uniform float drawDistance;
        uniform float drawOffset;

        varying vec2 facePosition;

        void main() {
            vec2 roadPos = vec2(
                facePosition.x * 4.75,
                facePosition.y * drawDistance + drawOffset
            );

            vec2 asphaltPos = roadPos * vec2(20.0, 10.0);

            float wearNoise = cnoise2(roadPos / vec2(4.3, 12.9));
            float asphaltNoise = cnoise2(vec2(
                asphaltPos.x - mod(asphaltPos.x, 0.5),
                asphaltPos.y - mod(asphaltPos.y, 0.5)
            ));

            float asphaltSpec = clamp((asphaltNoise - 0.8) / 0.2, 0.0, 1.0);
            float asphaltCrack = clamp(-0.6 - asphaltNoise, 0.0, 1.0) / 0.4;

            float lanePos = mod((facePosition.x + 1.0) * 1.6 - 0.1, 1.0);
            float side = 1.0 - step(0.02, lanePos) * step(lanePos, 0.98);

            vec3 color = side * mod(roadPos.y, 4.0) > 2.0
                ? vec3(0.25, 0.25, 0.27)
                : vec3(0.16, 0.16, 0.18) * (1.0 - asphaltCrack * 0.3 + asphaltSpec * 0.8);

            gl_FragColor = vec4(color * (0.88 + wearNoise * 0.12), 1.0);
        }
    `,

    attributes: {
        position: regl.buffer([
            [ -1, 0 ],
            [ 1, 0 ],
            [ 1,  1 ],
            [ -1, 1 ]
        ])
    },

    uniforms: {
        aspectRatio: regl.prop('aspectRatio'),
        drawDistance: regl.prop('drawDistance'),
        drawOffset: regl.prop('drawOffset'),
        camera: regl.prop('camera')
    },

    primitive: 'triangle fan',
    count: 4
});

fogCmd = regl({
    vert: glsl`
        precision mediump float;

        attribute vec2 position;

        void main() {
            gl_Position = vec4(position, 0, 1.0);
        }
    `,

    frag: glsl`
        #extension GL_EXT_frag_depth: require
        precision mediump float;

        // from glsl-dither/8x8.glsl by @hughsk
        float ditherLimit8x8(vec2 position) {
          int x = int(mod(position.x, 8.0));
          int y = int(mod(position.y, 8.0));
          int index = x + y * 8;
          float limit = 0.0;

          if (x < 8) {
            if (index == 0) limit = 0.015625;
            if (index == 1) limit = 0.515625;
            if (index == 2) limit = 0.140625;
            if (index == 3) limit = 0.640625;
            if (index == 4) limit = 0.046875;
            if (index == 5) limit = 0.546875;
            if (index == 6) limit = 0.171875;
            if (index == 7) limit = 0.671875;
            if (index == 8) limit = 0.765625;
            if (index == 9) limit = 0.265625;
            if (index == 10) limit = 0.890625;
            if (index == 11) limit = 0.390625;
            if (index == 12) limit = 0.796875;
            if (index == 13) limit = 0.296875;
            if (index == 14) limit = 0.921875;
            if (index == 15) limit = 0.421875;
            if (index == 16) limit = 0.203125;
            if (index == 17) limit = 0.703125;
            if (index == 18) limit = 0.078125;
            if (index == 19) limit = 0.578125;
            if (index == 20) limit = 0.234375;
            if (index == 21) limit = 0.734375;
            if (index == 22) limit = 0.109375;
            if (index == 23) limit = 0.609375;
            if (index == 24) limit = 0.953125;
            if (index == 25) limit = 0.453125;
            if (index == 26) limit = 0.828125;
            if (index == 27) limit = 0.328125;
            if (index == 28) limit = 0.984375;
            if (index == 29) limit = 0.484375;
            if (index == 30) limit = 0.859375;
            if (index == 31) limit = 0.359375;
            if (index == 32) limit = 0.0625;
            if (index == 33) limit = 0.5625;
            if (index == 34) limit = 0.1875;
            if (index == 35) limit = 0.6875;
            if (index == 36) limit = 0.03125;
            if (index == 37) limit = 0.53125;
            if (index == 38) limit = 0.15625;
            if (index == 39) limit = 0.65625;
            if (index == 40) limit = 0.8125;
            if (index == 41) limit = 0.3125;
            if (index == 42) limit = 0.9375;
            if (index == 43) limit = 0.4375;
            if (index == 44) limit = 0.78125;
            if (index == 45) limit = 0.28125;
            if (index == 46) limit = 0.90625;
            if (index == 47) limit = 0.40625;
            if (index == 48) limit = 0.25;
            if (index == 49) limit = 0.75;
            if (index == 50) limit = 0.125;
            if (index == 51) limit = 0.625;
            if (index == 52) limit = 0.21875;
            if (index == 53) limit = 0.71875;
            if (index == 54) limit = 0.09375;
            if (index == 55) limit = 0.59375;
            if (index == 56) limit = 1.0;
            if (index == 57) limit = 0.5;
            if (index == 58) limit = 0.875;
            if (index == 59) limit = 0.375;
            if (index == 60) limit = 0.96875;
            if (index == 61) limit = 0.46875;
            if (index == 62) limit = 0.84375;
            if (index == 63) limit = 0.34375;
          }

          return limit;
        }

        void main() {
            float limit = ditherLimit8x8(gl_FragCoord.xy);

            gl_FragColor = vec4(vec3(0.1, 0.1, 0.1), 1.0);
            gl_FragDepthEXT = 1.0 - 0.05 * limit * limit;
        }
    `,

    attributes: {
        position: regl.buffer([
            [ -1, -1 ],
            [ 1, -1 ],
            [ 1,  1 ],
            [ -1, 1 ]
        ])
    },

    uniforms: {
    },

    primitive: 'triangle fan',
    count: 4
});

const cameraPosition = vec3.create();
const camera = mat4.create();

const STEP = 1 / 60.0;

const CAMERA_HEIGHT = 2.5;
const DRAW_CYCLE = 100;
const DRAW_DISTANCE = DRAW_CYCLE * 4;

let offset = 0;
const speed = 90 / 3.6; // km/h to m/s

const timer = new Timer(STEP, 0, function () {
    offset += speed * STEP;
}, function (now) {
    mat4.perspective(camera, 0.6, canvas.width / canvas.height, 1, DRAW_DISTANCE - DRAW_CYCLE);

    // pitch
    mat4.rotateX(camera, camera, -Math.PI / 2);

    // camera shake and offset
    vec3.set(cameraPosition, 0.02 * Math.sin(now * 3.43), 0, -CAMERA_HEIGHT + 0.02 * Math.cos(now * 2.31));
    mat4.translate(camera, camera, cameraPosition);

    fogCmd({
    });

    roadCmd({
        aspectRatio: aspectRatio,
        drawDistance: DRAW_DISTANCE,
        drawOffset: offset,
        camera: camera
    });
});

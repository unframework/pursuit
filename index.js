const onecolor = require('onecolor');
const vec2 = require('gl-matrix').vec2;
const vec3 = require('gl-matrix').vec3;
const vec4 = require('gl-matrix').vec4;
const mat4 = require('gl-matrix').mat4;

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
    canvas: canvas
});

roadCmd = regl({
    vert: `
        precision mediump float;

        uniform mat4 camera;
        uniform float drawDistance;
        uniform float drawOffset;
        attribute vec2 position;

        varying vec2 facePosition;

        void main() {
            facePosition = position;

            gl_Position = camera * vec4(
                position.x * 4.75,
                position.y * drawDistance + drawOffset,
                0,
                1.0
            );
        }
    `,

    frag: `
        precision mediump float;

        uniform float drawDistance;

        varying vec2 facePosition;

        void main() {
            float dist = facePosition.y * drawDistance;
            float lanePos = mod((facePosition.x + 1.0) * 1.6 - 0.1, 1.0);
            float side = 1.0 - step(0.02, lanePos) * step(lanePos, 0.98);

            float intensity = side * mod(dist, 4.0) > 2.0 ? 1.0 : 0.85;
            gl_FragColor = vec4(vec3(0.15, 0.25, 0.3) * intensity, 1.0);
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
    vec3.set(cameraPosition, 0.02 * Math.sin(now * 3.43), -offset, -CAMERA_HEIGHT + 0.02 * Math.cos(now * 2.31));
    mat4.translate(camera, camera, cameraPosition);

    regl.clear({
        color: [ 0.2, 0.2, 0.2, 1 ],
        depth: 1
    });

    const drawOffset = Math.floor(offset / DRAW_CYCLE) * DRAW_CYCLE;

    roadCmd({
        aspectRatio: aspectRatio,
        drawDistance: DRAW_DISTANCE,
        drawOffset: drawOffset,
        camera: camera
    });
});

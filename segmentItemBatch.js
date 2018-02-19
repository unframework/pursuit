const glsl = require('glslify');

const { renderSegments } = require('./segment');

function createSegmentItemBatchCommand(regl, itemCount, itemPlacement, itemFrag) {
    return regl({
        vert: glsl`
            precision mediump float;

            #pragma glslify: computeSegmentX = require('./segment')

            uniform float segmentOffset;
            uniform float segmentLength;
            uniform vec3 segmentCurve;

            uniform int batchIndex;
            uniform float batchSize;
            uniform float batchItemSpacing;

            uniform float cameraOffset;
            uniform mat4 camera;

            attribute vec3 position;

            varying vec2 facePosition;
            varying float xOffset;
            varying float depth;
            varying float segmentDepth;

            ${itemPlacement}

            void main() {
                float segmentStartItemIndex = ceil((segmentOffset - getItemOffset()) / batchItemSpacing);
                float nextSegmentStartItemIndex = ceil((segmentOffset + segmentLength - getItemOffset()) / batchItemSpacing);

                float segmentItemIndex = segmentStartItemIndex + float(batchIndex) * batchSize + position.z;
                float viewPlanePositionY = segmentItemIndex * batchItemSpacing + getItemOffset();
                segmentDepth = viewPlanePositionY - segmentOffset;
                xOffset = computeSegmentX(segmentDepth, segmentCurve);

                facePosition = position.xy;
                depth = viewPlanePositionY - cameraOffset;

                vec2 itemSize = getItemSize();

                gl_Position = camera * vec4(
                    getItemCenter() + vec3(
                        position.x * itemSize.x + xOffset,
                        segmentItemIndex < nextSegmentStartItemIndex ? viewPlanePositionY : -1.0,
                        position.y * itemSize.y
                    ),
                    1.0
                );
            }
        `,

        frag: glsl`
            precision mediump float;

            #pragma glslify: roadSettings = require('./roadSettings')

            varying vec2 facePosition;
            varying float xOffset;
            varying float depth;
            varying float segmentDepth;

            ${itemFrag}
        `,

        attributes: {
            position: regl.buffer([
                Array.apply(null, new Array(itemCount)).map((noop, index) => [
                    [ -1, -1, index ],
                    [ 1, -1, index ],
                    [ -1, 1, index ],
                    [ 1,  1, index ],

                    [ 1,  1, index ],
                    [ -1, -1, (index + 1) ]
                ])
            ])
        },

        uniforms: {
            segmentOffset: regl.prop('segmentOffset'),
            segmentLength: regl.prop('segmentLength'),
            segmentCurve: regl.prop('segmentCurve'),

            batchIndex: regl.prop('batchIndex'),
            batchSize: regl.prop('batchSize'),
            batchItemSpacing: regl.prop('batchItemSpacing'),

            cameraOffset: regl.prop('cameraOffset'),
            camera: regl.prop('camera')
        },

        primitive: 'triangle strip',
        count: itemCount * 6
    });
}

function renderSegmentItems(itemSpacing, itemBatchSize, itemCommand, segmentList, cameraOffset, camera) {
    renderSegments(segmentList, cameraOffset, function (
        segmentOffset,
        segmentLength,
        segmentCurve,
        segment
    ) {
        const count = Math.ceil(segmentLength / (itemSpacing * itemBatchSize));

        for (let i = 0; i < count; i += 1) {
            itemCommand({
                segmentOffset: segmentOffset,
                segmentLength: segmentLength,
                segmentCurve: segmentCurve,

                batchIndex: i,
                batchSize: itemBatchSize,
                batchItemSpacing: itemSpacing,

                cameraOffset: cameraOffset,
                camera: camera
            });
        }
    });
}

module.exports = {
    createSegmentItemBatchCommand,
    renderSegmentItems
};

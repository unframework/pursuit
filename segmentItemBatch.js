const glsl = require('glslify');

function getSegmentItemBatchDefinition(itemPlacement, itemFrag) {
    return {
        vert: glsl`
            precision mediump float;

            #pragma glslify: computeSegmentX = require('./segment')

            uniform float segmentOffset;
            uniform float segmentLength;
            uniform vec3 segmentCurve;

            uniform int batchIndex;
            uniform float batchSize;
            uniform float batchItemSpacing;

            uniform mat4 camera;

            attribute vec3 position;

            varying vec2 facePosition;
            varying float xOffset;
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

            varying vec2 facePosition;
            varying float xOffset;
            varying float segmentDepth;

            ${itemFrag}
        `
    };
}

function createSegmentItemBatchRenderer(regl, itemSpacing, itemBatchSize) {
    const scopeCommand = regl({
        uniforms: {
            batchIndex: regl.prop('batchIndex'),
            batchSize: regl.prop('batchSize'),
            batchItemSpacing: regl.prop('batchItemSpacing'),

            camera: regl.prop('camera')
        },

        attributes: {
            position: regl.buffer([
                Array.apply(null, new Array(itemBatchSize)).map((noop, index) => [
                    [ -1, -1, index ],
                    [ 1, -1, index ],
                    [ -1, 1, index ],
                    [ 1,  1, index ],

                    [ 1,  1, index ],
                    [ -1, -1, (index + 1) ]
                ])
            ])
        },

        primitive: 'triangle strip',
        count: itemBatchSize * 6
    });

    return function (segmentLength, camera, cb) {
        const count = Math.ceil(segmentLength / (itemSpacing * itemBatchSize));

        for (let i = 0; i < count; i += 1) {
            scopeCommand({
                batchIndex: i,
                batchSize: itemBatchSize,
                batchItemSpacing: itemSpacing,

                camera: camera
            }, cb);
        }
    };
}

module.exports = {
    getSegmentItemBatchDefinition,
    createSegmentItemBatchRenderer
};

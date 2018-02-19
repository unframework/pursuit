const vec3 = require('gl-matrix').vec3;

const tmpCurve = vec3.create();

function renderSegments(segmentList, offset, cb) {
    let x = 0;
    let dx = 0;

    segmentList.forEach(function (segment) {
        // ensure segment vertices are not "behind" camera, otherwise perspective correction gets busted
        const segmentOffset = Math.max(offset + 3, segment.end - segment.length);

        vec3.set(
            tmpCurve,
            x,
            dx,
            segment.curvature
        );

        cb(
            segmentOffset,
            segment.end - segmentOffset,
            tmpCurve
        );

        const depth = 0.01 * (segment.end - segmentOffset);
        x += segment.curvature * depth * depth + dx * depth;
        dx += 2 * segment.curvature * depth;
    });
}

module.exports = {
    renderSegments
};

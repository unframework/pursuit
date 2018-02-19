
float computeSegmentX(float segmentDepth, vec3 segmentCurve) {
    float viewDepth = 0.01 * segmentDepth;

    return segmentCurve[2] * viewDepth * viewDepth + segmentCurve[1] * viewDepth + segmentCurve[0];
}

float computeSegmentDX(float dy, float segmentDepth, vec3 segmentCurve) {
    return segmentCurve[2] * dy * (2.0 * segmentDepth + dy) * 0.01 * 0.01 +
        segmentCurve[1] * dy * 0.01;
}

#pragma glslify: export(computeSegmentX)

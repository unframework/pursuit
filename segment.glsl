
float computeSegmentX(float viewPlaneOffset, float startOffset, float segmentCurvature, float segmentX, float segmentDX) {
    float viewDepth = 0.01 * (viewPlaneOffset - startOffset);

    return segmentCurvature * viewDepth * viewDepth + segmentDX * viewDepth + segmentX;
}

float computeSegmentDX(float dy, float segmentDepth, float segmentCurvature, float segmentDX) {
    return segmentCurvature * dy * (2.0 * segmentDepth + dy) * 0.01 * 0.01 +
        segmentDX * dy * 0.01;
}

#pragma glslify: export(computeSegmentX)

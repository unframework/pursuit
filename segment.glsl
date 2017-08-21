
float computeSegmentX(float viewPlaneOffset, float startOffset, float segmentCurvature, float segmentX, float segmentDX) {
    float viewDepth = 0.01 * (viewPlaneOffset - startOffset);

    return segmentCurvature * viewDepth * viewDepth + segmentDX * viewDepth + segmentX;
}

#pragma glslify: export(computeSegmentX)

import { Config } from '@remotion/cli/config'

// PNG frames + bt709 tagging: the jpeg path yields yuvj420p/bt601 streams that
// players decode with shifting colors; this roundtrips sRGB exactly.
Config.setVideoImageFormat('png')
Config.setPixelFormat('yuv420p')
Config.setColorSpace('bt709')
Config.setOverwriteOutput(true)

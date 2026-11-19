/**
 * The marker a look leaves in the Examiner's conversation in place of its
 * image. Pure, so the workflow body may use it: the history that travels
 * from step to step holds only keys, and the turn step loads the bytes.
 */
export const IMAGE_MARK =
  /^\[\[loupe-image:((?:pages|looks)\/[\w.-]+\.jpg)\]\]$/;

export const imageMark = (key: string) => `[[loupe-image:${key}]]`;

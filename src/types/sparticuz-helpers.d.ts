declare module "@sparticuz/chromium/build/lambdafs.js" {
  const LambdaFS: { inflate: (path: string) => Promise<string> };
  export default LambdaFS;
}

declare module "@sparticuz/chromium/build/helper.js" {
  export function setupLambdaEnvironment(baseLibPath: string): void;
}

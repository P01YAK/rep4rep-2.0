@echo off
echo Building Rep4Rep Bot for Windows...
pnpm install
pnpm run build-win
echo Build completed! Check the dist folder.
pause


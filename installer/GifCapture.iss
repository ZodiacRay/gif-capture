; Inno Setup script for GifCapture.
; Build:  ISCC.exe /DSourceDir="<folder with the published GifCapture.exe>" GifCapture.iss
; Publish the exe first, e.g.:
;   dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o publish

#define AppName "GifCapture"
; Keep in sync with <Version> in GifCapture.csproj.
#ifndef AppVersion
  #define AppVersion "0.2.0"
#endif
#define AppExe "GifCapture.exe"

#ifndef SourceDir
  #define SourceDir "..\publish"
#endif

[Setup]
; Keep this GUID fixed so new versions upgrade the existing installation.
AppId={{C9D33163-0FD9-4284-A070-C02C866A5B4D}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=minsung
AppPublisherURL=https://github.com/ZodiacRay/gif-capture
AppSupportURL=https://github.com/ZodiacRay/gif-capture/issues
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
UninstallDisplayIcon={app}\{#AppExe}
SetupIconFile=..\app.ico
LicenseFile=..\LICENSE
OutputBaseFilename=GifCapture-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
; Installs for the current user without admin rights; the user can still choose "for all users" at the prompt.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; Screen-capture exclusion needs Windows 10 version 2004 (build 19041) or later.
MinVersion=10.0.19041

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
Source: "{#SourceDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
; The in-app updater runs this setup silently with /update=1 and expects the app to come back afterwards.
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: IsUpdateRun

[Code]
function IsUpdateRun: Boolean;
begin
  Result := ExpandConstant('{param:update|0}') = '1';
end;

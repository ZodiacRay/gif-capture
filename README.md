# GifCapture

화면 영역을 녹화해서 GIF로 편집·저장하는 Windows용 데스크톱 앱입니다. WPF(.NET 9)로 만들었습니다.

## 다운로드

링크를 누르면 최신 버전이 바로 내려받아집니다.

- **[설치 프로그램 (추천)](https://github.com/ZodiacRay/gif-capture/releases/latest/download/GifCapture-Setup.exe)** — 시작 메뉴 바로가기가 만들어지고, Windows 설정의 "앱"에서 제거할 수 있습니다. 관리자 권한이 필요 없습니다.
- **[압축 파일 (zip)](https://github.com/ZodiacRay/gif-capture/releases/latest/download/GifCapture-win-x64.zip)** — 압축을 풀고 `GifCapture.exe`를 바로 실행합니다.

둘 다 .NET을 따로 설치할 필요가 없습니다. 코드 서명이 없어서 처음 실행할 때 Windows SmartScreen 경고가 뜰 수 있으며, **추가 정보 → 실행**을 누르면 열립니다. 이전 버전과 변경 내역은 [Releases](https://github.com/ZodiacRay/gif-capture/releases)에서 볼 수 있습니다.

### 웹 버전

설치 없이 브라우저에서 쓰는 버전도 있습니다. 소스는 [`web/`](web/) 폴더에 있고, 사용법과 개발 방법은 [web/README.md](web/README.md)를 참고하세요.

### 업데이트

앱을 켜면 새 버전이 있는지 확인하고, 있으면 메인 창 위쪽에 알림이 뜹니다. **업데이트**를 누르면 새 설치 프로그램을 받아 설치하고 앱을 다시 실행합니다. 메인 창 아래의 **업데이트 확인** 버튼으로 직접 확인할 수도 있습니다.

- 확인할 때 GitHub에 최신 릴리스 정보를 한 번 요청합니다. 이 외의 정보는 보내지 않습니다. 메인 창의 **시작할 때 새 버전 확인**을 끄면 요청하지 않습니다.
- 받은 설치 프로그램은 이 저장소의 릴리스 주소에서만 받고, 파일 크기와 SHA-256 해시가 맞는지 검사한 뒤에만 실행합니다. 검사에 실패하면 파일을 지우고 실행하지 않습니다.
- zip으로 쓰는 경우는 자동으로 바뀌지 않으므로, 알림이 뜨면 새 zip을 받아서 교체하세요.

## 기능

**녹화**
- 크기를 조절할 수 있는 투명 프레임으로 녹화 영역 지정 (가장자리를 끌어 크기 조절, 제목줄을 끌어 이동)
- `F7` 전역 단축키로 녹화 시작/정지 (다른 앱에 포커스가 있어도 동작)
- fps와 영역 크기(px) 직접 입력, 녹화 경과 시간 표시
- 타이머: 정한 시간(초)이 지나면 자동으로 녹화 종료
- 마지막 설정 기억: 영역 크기, 프레임 위치, fps, 타이머, 고정 여부를 다음 녹화에도 그대로 사용
- 녹화 중에도 프레임 이동 가능, 📌 고정으로 이동 잠금
- 프레임 창 자체는 녹화 결과에 찍히지 않음

**편집**
- 프레임 썸네일 목록 (프레임 번호와 지연 시간 표시)
- 재생 컨트롤: 맨 처음 / 이전 / 재생·정지 / 다음 / 맨 마지막, 반복 재생, 재생 속도 배율
- 프레임 삭제, 앞쪽·뒤쪽 프레임 일괄 삭제
- 화면 자르기 (핸들로 크기 조절, 안쪽을 끌어 이동)
- 글자 추가 (크기·색 선택, 위치 지정, 선택한 프레임에만 적용 가능)
- `Ctrl+Z` 되돌리기 (자르기, 글자 추가, 프레임 삭제 모두 지원)

**불러오기 / 내보내기**
- 기존 GIF 파일을 불러와서 같은 방식으로 편집 (프레임별 지연 시간 유지)
- GIF 저장 (반복 여부 선택). 이전 프레임에서 바뀐 부분만 저장해서 화면 녹화 용량을 줄임
- 목표 용량(MB) 지정: 해상도를 자동으로 줄여 용량에 맞춰 저장

**기타**
- 라이트 / 다크 모드 (처음에는 Windows 앱 테마를 따르고, 이후 선택을 기억)

## 요구 사항

- Windows 10 (버전 2004 이상) 또는 Windows 11
- 위 다운로드 파일로 실행할 때는 추가로 필요한 것이 없습니다.
- 소스에서 직접 빌드하려면 [.NET 9 SDK](https://dotnet.microsoft.com/download/dotnet/9.0)가 필요합니다.

## 빌드와 실행

```powershell
dotnet build
dotnet run
```

빌드 결과는 `bin\Debug\net9.0-windows\GifCapture.exe`에 생깁니다.

### 배포 파일 만들기

.NET을 포함한 단일 exe를 만들고, [Inno Setup](https://jrsoftware.org/isinfo.php)으로 설치 프로그램을 만듭니다.

```powershell
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=none -o publish
ISCC.exe /DSourceDir="..\publish" /Odist installer\GifCapture.iss
```

설치 프로그램은 `dist\`에 생깁니다. 설치 스크립트는 [`installer/GifCapture.iss`](installer/GifCapture.iss)입니다.

버전은 `GifCapture.csproj`의 `<Version>`과 `installer/GifCapture.iss`의 `AppVersion` 두 곳에서 같이 올립니다. 앱의 업데이트 알림은 실행 중인 앱의 버전과 최신 릴리스의 태그(`v0.2.0` 등)를 비교합니다.

새 릴리스를 올릴 때는 파일 이름에서 버전을 빼고 `GifCapture-Setup.exe`, `GifCapture-win-x64.zip`으로 올려야 합니다. 그래야 위 다운로드 링크(`releases/latest/download/...`)가 항상 최신 파일을 가리킵니다.

## 사용 방법

1. 메인 창에서 **녹화 시작**을 누르면 투명 프레임이 나타납니다.
2. 프레임 크기와 위치를 맞추고 fps를 정한 뒤 **녹화** 버튼 또는 `F7`을 누릅니다.
3. 다시 누르면 녹화가 끝나고 편집기가 열립니다.
4. 편집기에서 프레임을 다듬고 **GIF 내보내기**로 저장합니다.

이미 있는 GIF는 메인 창의 **GIF 불러오기**로 열 수 있습니다.

## 알아둘 점

- 녹화한 프레임은 임시 폴더(`%TEMP%\GifCapture`)에 저장되고, 편집할 때마다 새 이미지가 추가로 생깁니다. 앱을 종료해도 자동으로 지워지지 않으니 필요하면 직접 정리하세요.
- 설정은 `%AppData%\GifCapture`에 저장됩니다: 테마(`theme.txt`), 녹화 설정(`recorder.json`), 업데이트 확인 여부(`update-check.txt`). 이 파일들을 지우면 기본값으로 돌아갑니다.
- 용량 제한 저장은 해상도만 줄입니다. 프레임 수와 색상 수는 그대로입니다.
- 글자는 한 번에 한 줄만 넣을 수 있습니다.
- 주 모니터 한 대 환경 위주로 만들었고, 여러 모니터나 배율이 다른 환경은 충분히 검증하지 못했습니다.

## 라이선스

[MIT License](LICENSE)

GIF 인코더(색상 줄이기, LZW 압축, 변경된 영역만 저장)는 외부 라이브러리 없이 직접 구현했습니다(`GifWriter.cs`). 외부 의존성은 Microsoft의 `System.Drawing.Common`(MIT) 하나뿐입니다.

## 참고

[ScreenToGif](https://github.com/NickeManarin/ScreenToGif)의 화면 구성에서 아이디어를 얻었습니다. ScreenToGif의 소스 코드를 복사하지 않았고, 이 프로젝트는 ScreenToGif와 관련이 없습니다.

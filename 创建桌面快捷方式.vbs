' zcode-statusbar - desktop shortcut installer.
' Creates "ZCode (statusbar).lnk" on the desktop, pointing at the
' silent launcher next to this file.
'
' Pure ASCII on purpose: safe under any WScript code page, no BOM needed.
Option Explicit

Dim sh, fso, here, lnkPath, sc, exePath, cand
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here    = fso.GetParentFolderName(WScript.ScriptFullName)

If Not fso.FileExists(fso.BuildPath(here, "start-zcode-silent.vbs")) Then
  MsgBox "start-zcode-silent.vbs not found next to this script:" & vbCrLf & here, 16, "zcode-statusbar"
  WScript.Quit 1
End If

' Borrow the icon from the real ZCode.exe when we can find one
exePath = ""
For Each cand In Array( _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\ZCode\ZCode.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\ZCode\ZCode.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\ZCode\ZCode.exe", _
  "D:\ZCode\ZCode.exe", _
  "E:\ZCode\ZCode.exe" _
)
  If exePath = "" And fso.FileExists(cand) Then exePath = cand
Next

lnkPath = sh.SpecialFolders("Desktop") & "\ZCode (statusbar).lnk"
Set sc = sh.CreateShortcut(lnkPath)
sc.TargetPath = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\wscript.exe"
sc.Arguments = """" & fso.BuildPath(here, "start-zcode-silent.vbs") & """"
sc.WorkingDirectory = here
If exePath <> "" Then sc.IconLocation = exePath & ",0"
sc.Save

sh.Popup "Desktop shortcut created:" & vbCrLf & lnkPath & vbCrLf & vbCrLf & _
         "Double-click it to start ZCode with the status bar.", 0, "zcode-statusbar", 64
WScript.Quit 0

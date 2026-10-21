' Lance un script PowerShell de ce dossier sans aucune fenetre (pas meme un flash de console).
'   wscript.exe launch-hidden.vbs <script.ps1> [arguments...]
Dim shell, fso, dir, i, args, arg
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
If WScript.Arguments.Count = 0 Then WScript.Quit 1
args = ""
For i = 1 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If InStr(arg, " ") > 0 Then arg = """" & arg & """"
  args = args & " " & arg
Next
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & dir & "\" & WScript.Arguments(0) & """" & args, 0, False

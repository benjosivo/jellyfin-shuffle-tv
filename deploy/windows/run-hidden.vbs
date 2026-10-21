' Lance run.ps1 sans fenetre (appele par la tache planifiee "Jellyfin en boucle").
' Argument optionnel : le port de l'interface.
Dim shell, fso, dir, port
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
port = "8787"
If WScript.Arguments.Count > 0 Then port = WScript.Arguments(0)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & dir & "\run.ps1"" -Port " & port, 0, False

' 虚募阁 · CorelDRAW 批导出位图
' 变量 XU_WORKSPACE_ROOT 由生成器注入

Option Explicit

Sub ExportUiBatch()
    Dim workspaceRoot As String
    workspaceRoot = "{{XU_WORKSPACE_ROOT}}"
    Dim exportDir As String
    exportDir = workspaceRoot & "\UI\export"
    On Error Resume Next
    MkDir exportDir
    On Error GoTo 0

    Dim doc As Document
    Dim exported As Long
    exported = 0

    For Each doc In Application.Documents
        Dim outPath As String
        outPath = exportDir & "\" & SanitizeName(doc.Name) & ".png"
        doc.Export outPath, cdrPNG, cdrSelection
        exported = exported + 1
    Next doc

    MsgBox "Corel 位图导出: " & exported & " 个文档 → UI\export\"
End Sub

Private Function SanitizeName(ByVal n As String) As String
    Dim i As Long, c As String, out As String
    For i = 1 To Len(n)
        c = Mid(n, i, 1)
        If c Like "[A-Za-z0-9_-]" Or c = "." Then
            out = out & c
        Else
            out = out & "_"
        End If
    Next i
    SanitizeName = Replace(out, ".cdr", "", , , vbTextCompare)
End Function

' 虚募阁 · CorelDRAW 对象命名规范化

Option Explicit

Sub NormalizeShapeNames()
    Dim doc As Document
    If Application.Documents.Count = 0 Then
        MsgBox "请先打开文档"
        Exit Sub
    End If
    Set doc = Application.ActiveDocument
    Dim renamed As Long
    renamed = WalkPage(doc.ActivePage, "")
    MsgBox "已规范化对象名: " & renamed & " 处"
End Sub

Private Function WalkPage(ByVal page As Page, ByVal prefix As String) As Long
    Dim sh As Shape
    Dim count As Long
    count = 0
    For Each sh In page.Shapes
        Dim base As String
        base = NormalizeName(sh.Name)
        If sh.Name <> base Then
            sh.Name = base
            count = count + 1
        End If
        If sh.Type = cdrGroupShape Then
            count = count + WalkGroup(sh, prefix & base & "/")
        End If
    Next sh
    WalkPage = count
End Function

Private Function WalkGroup(ByVal grp As Shape, ByVal prefix As String) As Long
    Dim sh As Shape
    Dim count As Long
    count = 0
    For Each sh In grp.Shapes
        Dim base As String
        base = NormalizeName(sh.Name)
        If sh.Name <> base Then
            sh.Name = base
            count = count + 1
        End If
        If sh.Type = cdrGroupShape Then
            count = count + WalkGroup(sh, prefix & base & "/")
        End If
    Next sh
    WalkGroup = count
End Function

Private Function NormalizeName(ByVal n As String) As String
    Dim s As String
    s = Trim(n)
    s = Replace(s, " ", "_")
    NormalizeName = LCase(s)
End Function

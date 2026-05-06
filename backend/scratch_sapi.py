import win32com.client
import time
import pythoncom

def on_recognition(StreamNumber, StreamPosition, RecognitionType, Result):
    print(f"Recognized: {Result.PhraseInfo.GetText()}")

def test_sapi():
    pythoncom.CoInitialize()
    recognizer = win32com.client.Dispatch("SAPI.SpSharedRecognizer")
    context = recognizer.CreateRecoContext()
    grammar = context.CreateGrammar(1)
    grammar.DictationLoad()
    grammar.DictationSetState(1) # Active

    # Set up events
    class SapiEvents:
        def OnRecognition(self, StreamNumber, StreamPosition, RecognitionType, Result):
            print(f"SAPI: {Result.PhraseInfo.GetText()}")
            
    win32com.client.WithEvents(context, SapiEvents)
    
    print("Listening... Speak now.")
    for _ in range(10):
        pythoncom.PumpWaitingMessages()
        time.sleep(0.5)
    print("Done listening.")

if __name__ == "__main__":
    test_sapi()

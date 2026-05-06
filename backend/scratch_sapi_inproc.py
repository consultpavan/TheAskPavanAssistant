import win32com.client
import pythoncom
import time

def test_sapi_inproc():
    pythoncom.CoInitialize()
    try:
        recognizer = win32com.client.Dispatch("SAPI.SpInprocRecognizer")
        audio_in = win32com.client.Dispatch("SAPI.SpMMAudioIn")
        recognizer.AudioInputStream = audio_in
        
        context = recognizer.CreateRecoContext()
        grammar = context.CreateGrammar(1)
        grammar.DictationLoad()
        grammar.DictationSetState(1)
        
        class SapiEvents:
            def OnRecognition(self, StreamNumber, StreamPosition, RecognitionType, Result):
                print(f"SAPI: {Result.PhraseInfo.GetText()}")
                
        win32com.client.WithEvents(context, SapiEvents)
        
        print("Listening in-proc... Speak now.")
        for _ in range(10):
            pythoncom.PumpWaitingMessages()
            time.sleep(0.5)
        print("Done listening.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_sapi_inproc()

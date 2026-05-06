import sounddevice as sd
import speech_recognition as sr
import queue
import time

def test_sd_sr():
    r = sr.Recognizer()
    q = queue.Queue()

    def callback(indata, frames, time_info, status):
        if status:
            print(status)
        q.put(bytes(indata))

    print("Listening via sounddevice...")
    try:
        with sd.RawInputStream(samplerate=16000, blocksize=16000*3, dtype='int16',
                               channels=1, callback=callback):
            for _ in range(2): 
                data = q.get()
                audio = sr.AudioData(data, 16000, 2)
                print("Recognizing...")
                try:
                    text = r.recognize_google(audio)
                    print(f"Recognized: {text}")
                except sr.UnknownValueError:
                    print("Could not understand audio")
                except sr.RequestError as e:
                    print(f"Could not request results; {e}")
    except Exception as e:
        print(f"Stream error: {e}")

if __name__ == "__main__":
    test_sd_sr()
